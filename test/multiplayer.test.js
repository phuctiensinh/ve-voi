'use strict';
// Trận đấu thật qua WebSocket: máy chủ chạy trên cổng ngẫu nhiên, mỗi người chơi là một kết nối riêng.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeRoom, createRoom, joinRoom, playTurn, sleep } = require('./helpers');

const WORDS = ['Khủng long bạo chúa', 'Tàu vũ trụ', 'Bánh xèo', 'Áo dài', 'Cầu Rồng', 'Chợ nổi', 'Đèn ông sao', 'Hồ Gươm', 'Trống đồng'];
const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
const has = (text, word) => text.toLocaleLowerCase('vi').includes(word.toLocaleLowerCase('vi'))
  || plain(text).toLowerCase().includes(plain(word).toLowerCase());
/**
 * Mọi gói tin client đã nhận, trừ hai thứ họ được phép biết từ trước:
 * danh sách từ tự thêm (chủ phòng tự gõ) và các lựa chọn từng được đưa ra khi chính họ là người vẽ.
 */
const seenText = (c, since = 0) => c.log.slice(since)
  .filter((m) => m.e !== 'turn:options')
  .map((m) => JSON.stringify(m.e === 'room:state' ? { ...m, d: { ...m.d, settings: { ...m.d.settings, customWords: [] } } } : m))
  .join('\n');

test('trận đầy đủ 3 người × 2 hiệp: xoay vòng, điểm khớp, không lộ từ, về phòng chờ, chơi lại', async () => {
  const srv = await startServer();
  try {
    const cs = await makeRoom(srv, ['An', 'Bình', 'Chi'], { rounds: 2, drawTime: 120, hints: 0, customWords: WORDS.join(', '), customOnly: true });
    const [A] = cs;
    A.send('host:start');
    await A.waitFor('room:state', (s) => s.phase === 'roundStart' && s.round === 1);

    const drawers = [];
    const deltas = new Map(cs.map((c) => [c.id, 0]));
    let after = 0;
    for (let t = 0; t < 6; t++) {
      const turn = await playTurn(cs, { after });
      after = turn.turnId;
      drawers.push(turn.drawer.id);
      assert.ok(WORDS.includes(turn.word), `từ "${turn.word}" phải lấy từ danh sách tự thêm`);
      assert.equal(turn.options.length, 3);

      // Người đoán: trước khi đoán ra, KHÔNG gói tin nào chứa từ khoá (kể cả dạng không dấu)
      for (const g of turn.guessers) {
        const st = await g.waitFor('room:state', (s) => s.phase === 'drawing' && s.turn.id === turn.turnId, { since: 0 });
        assert.equal(st.turn.word, null);
        assert.ok(Array.isArray(st.turn.mask) && st.turn.mask.length === [...turn.word].length, 'người đoán chỉ nhận mặt nạ');
        assert.ok(!has(seenText(g), turn.word), `lộ từ khoá "${turn.word}" cho ${g.name} trước khi đoán`);
        assert.equal(g.all('turn:options', (o) => o.turnId === turn.turnId).length, 0, 'người đoán không nhận danh sách từ');
      }
      // Người thứ nhất gõ không dấu, người thứ hai gõ đúng nguyên văn
      const [g1, g2] = turn.guessers;
      g1.send('chat', { text: plain(turn.word).toLowerCase() });
      await g1.waitFor('room:state', (s) => s.turn?.id === turn.turnId && s.turn.word === turn.word, { since: 0 });
      g2.send('chat', { text: turn.word });
      const end = await A.waitFor('turn:end', (e) => e.turnId === turn.turnId, { since: 0 });
      assert.equal(end.reason, 'allGuessed');
      assert.equal(end.word, turn.word);
      const dDrawer = end.deltas.find((x) => x.id === turn.drawer.id);
      const dG1 = end.deltas.find((x) => x.id === g1.id), dG2 = end.deltas.find((x) => x.id === g2.id);
      assert.ok(dDrawer.drawer && dDrawer.delta > 0, 'người vẽ có điểm khi có người đoán ra');
      assert.ok(dG1.delta >= dG2.delta && dG2.delta > 0, 'người đoán trước được nhiều điểm hơn hoặc bằng');
      for (const x of end.deltas) deltas.set(x.id, deltas.get(x.id) + x.delta);
    }
    // Mỗi hiệp mỗi người vẽ đúng một lần, cùng thứ tự
    assert.deepEqual(drawers.slice(0, 3).sort(), cs.map((c) => c.id).sort());
    assert.deepEqual(drawers.slice(3), drawers.slice(0, 3));

    const fin = await A.waitFor('game:end', () => true, { since: 0 });
    for (const r of fin.ranking) assert.equal(r.score, deltas.get(r.id), `điểm cuối của ${r.name} = tổng điểm từng lượt`);
    assert.deepEqual(fin.ranking.map((r) => r.rank), [1, 2, 3]);
    assert.ok(fin.titles.length >= 1);
    assert.equal((await A.waitFor('room:state', (s) => s.phase === 'gameEnd', { since: 0 })).phase, 'gameEnd');

    // Không phải chủ phòng thì không bấm "Về phòng chờ" được
    const B = cs[1];
    B.mark();
    B.send('host:lobby');
    assert.equal((await B.waitFor('error:action')).code, 'NOT_HOST');

    // Chủ phòng về phòng chờ → bắt đầu lại (điểm về 0) → dừng giữa chừng
    A.mark();
    A.send('host:lobby');
    await A.waitFor('room:state', (s) => s.phase === 'lobby');
    A.send('host:start');
    const again = await A.waitFor('room:state', (s) => s.phase === 'roundStart');
    assert.equal(again.round, 1);
    assert.ok(again.players.every((p) => p.score === 0), 'chơi lại thì điểm về 0');
    A.send('host:stop');
    await A.waitFor('room:state', (s) => s.phase === 'lobby');
  } finally {
    await srv.stop();
  }
});

test('màn tổng kết: chủ phòng bấm "Chơi lại" là bắt đầu ngay; không bấm thì cả phòng tự về phòng chờ', async () => {
  const srv = await startServer();
  try {
    const cs = await makeRoom(srv, ['Hoa', 'Lan'], { rounds: 1, drawTime: 120 });
    const [H] = cs;
    let after = 0;
    const playGame = async () => {
      for (let i = 0; i < 2; i++) {
        const t = await playTurn(cs, { after });
        after = t.turnId;
        t.guessers[0].send('chat', { text: t.word });
      }
    };
    H.send('host:start');
    await playGame();
    await H.waitFor('game:end', () => true, { since: 0 });
    H.mark();
    H.send('host:start'); // "Chơi lại" ngay trên màn tổng kết
    await H.waitFor('room:state', (s) => s.phase === 'roundStart' && s.round === 1);
    await playGame();
    await H.waitFor('room:state', (s) => s.phase === 'gameEnd');
    // gameEnd 25 giây × 0,05 ≈ 1,25 giây rồi tự về phòng chờ
    const back = await H.waitFor('room:state', (s) => s.phase === 'lobby', { timeout: 5000 });
    assert.equal(back.turn, null);
    assert.equal(back.phaseEndsAt, 0);
  } finally {
    await srv.stop();
  }
});

test('hết giờ không ai đoán ra: người vẽ 0 điểm, có gợi ý mở dần, công bố đáp án', async () => {
  const srv = await startServer(); // lượt vẽ 30 giây × 0,05 = 1,5 giây
  try {
    const cs = await makeRoom(srv, ['Vẽ', 'Đoán'], { rounds: 1, drawTime: 30, hints: 2 });
    cs[0].send('host:start');
    const turn = await playTurn(cs);
    const g = turn.guessers[0];
    await g.waitFor('sfx', (d) => d.name === 'hint', { since: 0, timeout: 4000 });
    const masked = await g.waitFor('room:state', (s) => s.phase === 'drawing' && s.turn.mask.some((c) => c !== '_' && c !== ' '), { since: 0 });
    assert.equal(masked.turn.word, null);
    const end = await g.waitFor('turn:end', (e) => e.turnId === turn.turnId, { since: 0, timeout: 5000 });
    assert.equal(end.reason, 'timeup');
    assert.equal(end.word, turn.word);
    assert.ok(end.deltas.every((x) => x.delta === 0));
    const st = await g.waitFor('room:state', (s) => s.phase === 'turnEnd', { since: 0 });
    assert.equal(st.turn.word, turn.word, 'hết lượt thì ai cũng thấy đáp án');
  } finally {
    await srv.stop();
  }
});

test('người vẽ không chọn từ kịp: máy chủ tự chọn giúp, trận không bị đứng', async () => {
  const srv = await startServer(); // thời gian chọn 15 giây × 0,05 = 0,75 giây
  try {
    const cs = await makeRoom(srv, ['A', 'B'], { rounds: 1, drawTime: 60 });
    cs[0].send('host:start');
    const choosing = await cs[0].waitFor('room:state', (s) => s.phase === 'choosing', { since: 0 });
    const drawer = cs.find((c) => c.id === choosing.turn.drawerId);
    const opts = await drawer.waitFor('turn:options', () => true, { since: 0 });
    const st = await drawer.waitFor('room:state', (s) => s.phase === 'drawing', { since: 0, timeout: 4000 });
    assert.ok(opts.options.some((o) => o.word === st.turn.word));
  } finally {
    await srv.stop();
  }
});

test('kết quả đoán qua mạng: gần đúng / sai dấu / chứa đáp án chỉ người gõ thấy; đáp án đúng không bị phát lại', async () => {
  const srv = await startServer();
  try {
    const cs = await makeRoom(srv, ['A', 'B', 'C'], { rounds: 1, drawTime: 120, customWords: 'Núi lửa, Tàu ngầm, Bánh chưng', customOnly: true });
    cs[0].send('host:start');
    const turn = await playTurn(cs);
    const [g1, g2] = turn.guessers;
    const w = turn.word;
    const p = plain(w).toLowerCase();
    const near = p.slice(0, -1) + (p.endsWith('x') ? 'y' : 'x');
    const wrongAccent = { 'Núi lửa': 'núi lừa', 'Tàu ngầm': 'tàu ngấm', 'Bánh chưng': 'bánh chừng' }[w];
    const since = g2.mark();
    g1.mark();
    g1.send('chat', { text: near });
    await g1.waitFor('chat:msg', (m) => m.type === 'close');
    g1.send('chat', { text: wrongAccent });
    await g1.waitFor('chat:msg', (m) => m.type === 'accent');
    g1.send('chat', { text: `mình nghĩ là ${w} đó` });
    await g1.waitFor('chat:msg', (m) => m.type === 'private' && /chứa đáp án/.test(m.text));
    g1.send('chat', { text: 'chắc là con mèo' });
    await g2.waitFor('chat:msg', (m) => m.text === 'chắc là con mèo');
    const seen = g2.all('chat:msg', () => true, since);
    assert.ok(seen.some((m) => m.text === near), 'đoán gần đúng vẫn hiện như chat thường cho người khác');
    assert.ok(!seen.some((m) => m.type === 'close' || m.type === 'accent'), 'thông báo "gần đúng" chỉ gửi người gõ');
    assert.ok(!seen.some((m) => m.text === wrongAccent), 'đúng chữ sai dấu bị ẩn (tránh lộ)');
    assert.ok(!has(seenText(g2, since), w), 'câu chứa đáp án bị ẩn');
    g1.send('chat', { text: w });
    await g2.waitFor('chat:msg', (m) => m.type === 'correct');
    assert.ok(!has(seenText(g2, since), w), 'đoán đúng chỉ báo "đã đoán chính xác", không phát lại từ');
  } finally {
    await srv.stop();
  }
});

test('chơi nhanh & danh sách phòng: phòng công khai hiện ra, phòng riêng thì không; tên trùng tự đánh số', async () => {
  const srv = await startServer();
  try {
    const priv = await createRoom(srv, 'Riêng', { isPrivate: true, name: 'Phòng bí mật' });
    const q1 = await srv.client('q1');
    q1.send('room:quick', { token: 'quick-1', profile: { name: 'Nhanh 1' } });
    const j1 = await q1.waitFor('room:joined');
    const q2 = await srv.client('q2');
    q2.send('room:quick', { token: 'quick-2', profile: { name: 'Nhanh 2' } });
    const j2 = await q2.waitFor('room:joined');
    assert.equal(j1.code, j2.code, 'chơi nhanh ghép vào cùng một phòng còn chỗ');
    assert.notEqual(j1.code, priv.code);
    const viewer = await srv.client('viewer');
    viewer.send('rooms:list');
    const list = await viewer.waitFor('rooms:list');
    assert.ok(list.some((r) => r.code === j1.code && r.players === 2));
    assert.ok(!list.some((r) => r.code === priv.code), 'phòng riêng không công khai');
    const dup = await joinRoom(srv, j1.code, 'Nhanh 1');
    assert.equal(dup.state.players.find((x) => x.id === dup.id).name, 'Nhanh 1 2');
  } finally {
    await srv.stop();
  }
});

test('lỗi nội bộ trong phòng không làm trận "đứng" và không lộ chi tiết kỹ thuật', async () => {
  const srv = await startServer();
  try {
    const cs = await makeRoom(srv, ['A', 'B'], { rounds: 1, drawTime: 60 });
    cs[0].send('host:start');
    await playTurn(cs);
    const room = srv.lobby.get(cs[0].code);
    const since = cs[1].mark();
    room.later(() => { throw new Error('lỗi giả lập'); }, 1); // lỗi trong một bộ hẹn giờ của phòng
    const st = await cs[1].waitFor('room:state', (s) => s.phase === 'lobby');
    assert.equal(st.turn, null);
    const msgs = cs[1].all('chat:msg', () => true, since).map((m) => m.text).join('\n');
    assert.ok(/Có lỗi xảy ra/.test(msgs));
    assert.ok(!/lỗi giả lập|Error|at /.test(msgs), 'không lộ chi tiết lỗi cho người chơi');
    // phòng vẫn chơi tiếp được
    cs[0].mark();
    cs[0].send('host:start');
    await cs[0].waitFor('room:state', (s) => s.phase === 'roundStart');
    await sleep(20);
  } finally {
    await srv.stop();
  }
});
