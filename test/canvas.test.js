'use strict';
// Đồng bộ bảng vẽ thời gian thực: thứ tự nét, người vào sau / nối lại, hoàn tác, xoá, kiểm tra đầu vào.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeRoom, joinRoom, playTurn, sleep } = require('./helpers');

/** Phòng 3 người đang ở pha vẽ. */
async function drawingRoom(srv, settings = {}) {
  const cs = await makeRoom(srv, ['Vẽ', 'Xem 1', 'Xem 2'], { rounds: 1, drawTime: 120, ...settings });
  cs[0].send('host:start');
  const t = await playTurn(cs);
  for (const g of t.guessers) await g.waitFor('room:state', (s) => s.phase === 'drawing' && s.turn.id === t.turnId, { since: 0 });
  return { cs, ...t };
}

test('100 nét vẽ tới người xem đúng thứ tự, đủ điểm, khớp với bản lưu trên máy chủ', async () => {
  const srv = await startServer({ timing: { scale: 0.2 } }); // lượt vẽ 24 giây: đủ thời gian gửi 100 nét theo nhịp thật
  try {
    const { drawer, guessers } = await drawingRoom(srv);
    const [g1, g2] = guessers;
    const since1 = g1.mark(), since2 = g2.mark();
    const sent = [];
    for (let i = 0; i < 100; i++) {
      const color = `#${(i * 2654435).toString(16).padStart(6, '0').slice(-6)}`;
      const size = 2 + (i % 30);
      const pts = [];
      drawer.send('draw:start', { c: color, s: size });
      for (let b = 0; b < 3; b++) {
        const batch = [i * 7 % 800, b * 50 + 10, (i * 7 + 13) % 800, b * 50 + 30, (i * 3) % 800, b * 50 + 45];
        pts.push(...batch);
        drawer.send('draw:pts', { p: batch });
      }
      drawer.send('draw:end');
      sent.push({ c: color, s: size, p: pts });
      if (i % 10 === 9) await sleep(300); // nhịp như người vẽ thật, trong giới hạn tần suất
    }
    for (const g of [g1, g2]) await g.waitFor('draw:end', () => g.all('draw:end', () => true, g === g1 ? since1 : since2).length >= 100, { timeout: 6000 });

    for (const [g, since] of [[g1, since1], [g2, since2]]) {
      const evs = g.log.slice(since).filter((m) => m.e.startsWith('draw:'));
      const strokes = [];
      let cur = null;
      for (const { e, d } of evs) {
        if (e === 'draw:start') { assert.equal(cur, null, 'nét mới bắt đầu khi nét cũ chưa xong'); cur = { id: d.id, c: d.c, s: d.s, p: [] }; }
        else if (e === 'draw:pts') { assert.equal(d.id, cur.id, 'điểm thuộc đúng nét'); cur.p.push(...d.p); }
        else if (e === 'draw:end') { assert.equal(d.id, cur.id); strokes.push(cur); cur = null; }
      }
      assert.equal(strokes.length, 100);
      for (let i = 1; i < strokes.length; i++) assert.ok(strokes[i].id > strokes[i - 1].id, 'id nét tăng dần');
      strokes.forEach((s, i) => assert.deepEqual({ c: s.c, s: s.s, p: s.p }, sent[i], `nét ${i}`));
    }
    // Bản lưu trên máy chủ (người vào sau sẽ nhận đúng bản này)
    g1.mark();
    g1.send('canvas:resync');
    const snap = await g1.waitFor('canvas:sync');
    assert.equal(snap.actions.length, 100);
    snap.actions.forEach((a, i) => assert.deepEqual({ c: a.c, s: a.s, p: a.p }, sent[i]));
    assert.equal(drawer.all('draw:start').length, 0, 'người vẽ không nhận lại nét của chính mình');
  } finally {
    await srv.stop();
  }
});

test('người vào sau thấy cả nét đang vẽ dở và vẽ tiếp được liền mạch', async () => {
  const srv = await startServer();
  try {
    const { cs, drawer } = await drawingRoom(srv);
    drawer.send('draw:start', { c: '#ff0000', s: 8 });
    drawer.send('draw:pts', { p: [10, 10, 20, 20] });
    drawer.send('draw:end');
    drawer.send('draw:start', { c: '#00ff00', s: 12 });
    drawer.send('draw:pts', { p: [100, 100, 110, 120] });
    await cs[1].waitFor('draw:pts', (d) => d.p[0] === 100);
    const late = await joinRoom(srv, cs[0].code, 'Đến muộn');
    const sync = await late.waitFor('canvas:sync', () => true, { since: 0 });
    assert.equal(sync.actions.length, 1);
    assert.deepEqual(sync.actions[0].p, [10, 10, 20, 20]);
    assert.ok(sync.live, 'có nét đang vẽ dở');
    assert.deepEqual({ c: sync.live.c, s: sync.live.s, p: sync.live.p }, { c: '#00ff00', s: 12, p: [100, 100, 110, 120] });
    // người vào muộn đang đoán: không nhận từ khoá
    assert.equal(late.state.turn.word, null);
    drawer.send('draw:pts', { p: [130, 140] });
    drawer.send('draw:end');
    const more = await late.waitFor('draw:pts', () => true);
    assert.equal(more.id, sync.live.id, 'điểm mới nối vào đúng nét dở');
    assert.equal((await late.waitFor('draw:end')).id, sync.live.id);
  } finally {
    await srv.stop();
  }
});

test('tải lại trang giữa lúc vẽ: nhận lại toàn bộ tranh, người vẽ vẫn vẽ tiếp được', async () => {
  const srv = await startServer();
  try {
    const { cs, drawer, guessers } = await drawingRoom(srv);
    drawer.send('draw:start', { c: '#123456', s: 6 });
    drawer.send('draw:pts', { p: [1, 2, 3, 4] });
    drawer.send('draw:end');
    await guessers[0].waitFor('draw:end');
    // người vẽ tải lại trang (kết nối mới, cùng token)
    drawer.drop();
    const again = await joinRoom(srv, cs[0].code, drawer.name, { token: drawer.token });
    assert.equal(again.id, drawer.id, 'giữ nguyên người chơi');
    const sync = await again.waitFor('canvas:sync', () => true, { since: 0 });
    assert.equal(sync.actions.length, 1);
    const st = again.state;
    assert.equal(st.phase, 'drawing');
    assert.ok(st.turn.word, 'người vẽ vẫn thấy từ khoá');
    guessers[0].mark();
    again.send('draw:start', { c: '#654321', s: 6 });
    again.send('draw:pts', { p: [5, 6, 7, 8] });
    again.send('draw:end');
    const got = await guessers[0].waitFor('draw:start');
    assert.equal(got.c, '#654321');
  } finally {
    await srv.stop();
  }
});

test('hoàn tác / làm lại / xoá do máy chủ xử lý, mọi người cùng thấy một trạng thái', async () => {
  const srv = await startServer();
  try {
    const { drawer, guessers } = await drawingRoom(srv);
    const [g1] = guessers;
    for (let i = 0; i < 3; i++) {
      drawer.send('draw:start', { c: '#000000', s: 4 });
      drawer.send('draw:pts', { p: [i, i, i + 5, i + 5] });
      drawer.send('draw:end');
    }
    drawer.send('draw:fill', { x: 400, y: 300, c: '#ffcc00' });
    const fill = await g1.waitFor('draw:action', (a) => a.type === 'fill');
    assert.deepEqual({ x: fill.x, y: fill.y, c: fill.c }, { x: 400, y: 300, c: '#ffcc00' });
    g1.mark(); drawer.mark();
    drawer.send('draw:undo');
    assert.equal((await g1.waitFor('canvas:sync')).actions.length, 3);
    assert.equal((await drawer.waitFor('canvas:sync')).actions.length, 3, 'người vẽ cũng nhận bản chuẩn từ máy chủ');
    g1.mark();
    drawer.send('draw:undo');
    assert.equal((await g1.waitFor('canvas:sync')).actions.length, 2);
    g1.mark();
    drawer.send('draw:redo');
    assert.equal((await g1.waitFor('canvas:sync')).actions.length, 3);
    g1.mark(); drawer.mark();
    drawer.send('draw:clear');
    await g1.waitFor('draw:action', (a) => a.type === 'clear');
    await drawer.waitFor('draw:action', (a) => a.type === 'clear');
    g1.mark();
    drawer.send('draw:undo');
    const back = await g1.waitFor('canvas:sync');
    assert.equal(back.actions.length, 3, 'hoàn tác được cả lệnh xoá');
    assert.ok(back.actions.every((a) => a.type === 'stroke'));
  } finally {
    await srv.stop();
  }
});

test('chỉ người vẽ, chỉ trong pha vẽ mới vẽ được; dữ liệu vẽ được kiểm tra & kẹp lại', async () => {
  const srv = await startServer();
  try {
    const { cs, drawer, guessers } = await drawingRoom(srv);
    const [g1, g2] = guessers;
    const since = g2.mark();
    // người đoán cố vẽ / xoá / hoàn tác
    g1.send('draw:start', { c: '#ff0000', s: 10 });
    g1.send('draw:pts', { p: [1, 1, 2, 2] });
    g1.send('draw:end');
    g1.send('draw:fill', { x: 1, y: 1, c: '#ff0000' });
    g1.send('draw:clear');
    g1.send('draw:undo');
    // người vẽ gửi dữ liệu lạ
    drawer.send('draw:start', { c: '#ZZZZZZ', s: 99 });
    drawer.send('draw:pts', { p: [-9999, 9999, 400.6, 300.4, 5] });
    drawer.send('draw:end');
    drawer.send('draw:start', { c: '#ff0000', s: 500 }); // cỡ quá lớn → bị từ chối
    drawer.send('draw:fill', { x: 5000, y: -50, c: '#00ff00' });
    await g2.waitFor('draw:action', (a) => a.type === 'fill');
    const evs = g2.log.slice(since).filter((m) => m.e.startsWith('draw:'));
    assert.deepEqual(evs.map((m) => m.e), ['draw:start', 'draw:pts', 'draw:end', 'draw:action'], 'chỉ thao tác của người vẽ được phát');
    const [start, pts, , fill] = evs.map((m) => m.d);
    assert.equal(start.c, '#111111', 'màu không hợp lệ → màu mặc định');
    assert.equal(start.s, 80, 'cỡ nét bị kẹp');
    assert.deepEqual(pts.p, [-20, 620, 401, 300], 'toạ độ bị kẹp & làm tròn, bỏ số lẻ cuối');
    assert.deepEqual([fill.x, fill.y], [799, 0]);
    assert.equal(g1.all('error:action', () => true, 0).filter((e) => /^draw:/.test(e.event || '')).length, 0, 'sự kiện vẽ sai không làm phiền bằng thông báo lỗi');

    // hết lượt rồi thì không vẽ được nữa
    for (const g of guessers) g.send('chat', { text: (await drawer.waitFor('room:state', (s) => s.turn?.word, { since: 0 })).turn.word });
    await cs[0].waitFor('room:state', (s) => s.phase === 'turnEnd', { since: 0 });
    g2.mark();
    drawer.send('draw:start', { c: '#ff0000', s: 10 });
    drawer.send('draw:pts', { p: [1, 1] });
    await sleep(150);
    assert.equal(g2.all('draw:start', () => true, g2.cursor).length, 0);
  } finally {
    await srv.stop();
  }
});

test('mỗi lượt mới bắt đầu với bảng trắng', async () => {
  const srv = await startServer();
  try {
    const { cs, drawer, guessers, turnId } = await drawingRoom(srv, { rounds: 1 });
    drawer.send('draw:start', { c: '#000000', s: 4 });
    drawer.send('draw:pts', { p: [1, 1, 2, 2] });
    drawer.send('draw:end');
    await guessers[0].waitFor('draw:end');
    const since = guessers[0].mark();
    for (const g of guessers) g.send('chat', { text: (await drawer.waitFor('room:state', (s) => s.turn?.word, { since: 0 })).turn.word });
    await playTurn(cs, { after: turnId });
    const syncs = guessers[0].all('canvas:sync', () => true, since);
    assert.ok(syncs.length >= 1);
    assert.equal(syncs.at(-1).actions.length, 0);
    assert.equal(syncs.at(-1).live, null);
  } finally {
    await srv.stop();
  }
});
