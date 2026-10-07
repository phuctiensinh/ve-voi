'use strict';
// Rớt mạng, tải lại trang, mở tab khác, người vẽ / chủ phòng mất kết nối, phòng còn quá ít người.
// Thời lượng × 0,05: giữ chỗ 2,25 giây, chờ người vẽ 0,6 giây, chờ chủ phòng 0,5 giây, chờ đủ người 0,6 giây
// (test nào cần "quay lại kịp" thì nới các mốc chờ lên 1,5 giây cho chắc chắn trên máy chậm).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeRoom, joinRoom, playTurn, sleep } = require('./helpers');

test('tải lại trang (cùng token): giữ nguyên người chơi, điểm, pha hiện tại', async () => {
  const srv = await startServer();
  try {
    const cs = await makeRoom(srv, ['A', 'B', 'C'], { rounds: 2, drawTime: 120 });
    cs[0].send('host:start');
    const t = await playTurn(cs);
    const g = t.guessers[0];
    g.send('chat', { text: t.word });
    const before = await g.waitFor('room:state', (s) => s.players.find((p) => p.id === g.id).score > 0, { since: 0 });
    const score = before.players.find((p) => p.id === g.id).score;
    g.drop();
    const g2 = await joinRoom(srv, cs[0].code, g.name, { token: g.token });
    assert.equal(g2.id, g.id);
    const st = g2.state;
    assert.equal(st.players.find((p) => p.id === g.id).score, score, 'giữ điểm');
    assert.equal(st.players.length, 3, 'không bị nhân đôi người chơi');
    assert.ok(['drawing', 'turnEnd'].includes(st.phase));
    if (st.phase === 'drawing') assert.equal(st.turn.word, t.word, 'đã đoán ra trước khi tải lại thì vẫn thấy từ');
    await g2.waitFor('canvas:sync', () => true, { since: 0 });
  } finally {
    await srv.stop();
  }
});

test('mở phòng ở tab thứ hai: tab cũ được báo và ngắt, không có người chơi ma', async () => {
  const srv = await startServer();
  try {
    const cs = await makeRoom(srv, ['A', 'B']);
    const [, B] = cs;
    const B2 = await joinRoom(srv, cs[0].code, 'B', { token: B.token });
    assert.equal(B2.id, B.id);
    const closed = await B.waitFor('room:closed', () => true, { since: 0 });
    assert.match(closed.reason, /tab khác/);
    await B.waitClose();
    assert.equal(B2.state.players.length, 2);
    // tab cũ đóng không làm người chơi bị đánh dấu mất kết nối
    await sleep(100);
    assert.ok(cs[0].state.players.every((p) => p.connected));
  } finally {
    await srv.stop();
  }
});

test('người đoán rớt mạng: hiện mất kết nối, giữ chỗ một lúc rồi mới xoá; không chặn "cả phòng đã đoán ra"', async () => {
  const srv = await startServer();
  try {
    const cs = await makeRoom(srv, ['A', 'B', 'C'], { rounds: 1, drawTime: 120 });
    cs[0].send('host:start');
    const t = await playTurn(cs);
    const [g1, g2] = t.guessers;
    const watcher = t.drawer;
    watcher.mark();
    g2.drop();
    const off = await watcher.waitFor('room:state', (s) => s.players.some((p) => p.id === g2.id && !p.connected));
    assert.equal(off.players.length, 3, 'vẫn giữ chỗ');
    g1.send('chat', { text: t.word });
    const end = await watcher.waitFor('turn:end', (e) => e.turnId === t.turnId, { since: 0 });
    assert.equal(end.reason, 'allGuessed', 'người mất kết nối không làm lượt bị treo');
    const gone = await watcher.waitFor('room:state', (s) => !s.players.some((p) => p.id === g2.id), { timeout: 5000 });
    assert.equal(gone.players.length, 2, 'hết thời gian giữ chỗ thì xoá khỏi phòng');
    assert.ok(watcher.all('chat:msg').some((m) => /rời phòng \(mất kết nối\)/.test(m.text)));
  } finally {
    await srv.stop();
  }
});

test('người vẽ rớt mạng: chờ một lúc, không quay lại thì bỏ lượt và chuyển người vẽ khác', async () => {
  const srv = await startServer();
  try {
    const cs = await makeRoom(srv, ['A', 'B', 'C'], { rounds: 1, drawTime: 120 });
    cs[0].send('host:start');
    const t = await playTurn(cs);
    const watcher = t.guessers[0];
    t.drawer.drop();
    const end = await watcher.waitFor('turn:end', (e) => e.turnId === t.turnId, { since: 0, timeout: 4000 });
    assert.equal(end.reason, 'drawerLeft');
    assert.equal(end.word, t.word, 'vẫn công bố đáp án');
    const next = await watcher.waitFor('room:state', (s) => s.phase === 'choosing' && s.turn.id > t.turnId, { since: 0, timeout: 4000 });
    assert.notEqual(next.turn.drawerId, t.drawer.id);
  } finally {
    await srv.stop();
  }
});

test('người vẽ rớt mạng rồi vào lại kịp: lượt vẫn tiếp tục, vẫn vẽ được', async () => {
  const srv = await startServer({ timing: { drawerGrace: 30000 } }); // chờ người vẽ 1,5 giây
  try {
    const cs = await makeRoom(srv, ['A', 'B', 'C'], { rounds: 1, drawTime: 120 });
    cs[0].send('host:start');
    const t = await playTurn(cs);
    const watcher = t.guessers[0];
    t.drawer.drop();
    await watcher.waitFor('room:state', (s) => s.players.some((p) => p.id === t.drawer.id && !p.connected), { since: 0 });
    const back = await joinRoom(srv, cs[0].code, t.drawer.name, { token: t.drawer.token });
    await sleep(1800); // lâu hơn thời gian chờ người vẽ (1,5 giây)
    assert.equal(back.state.phase, 'drawing');
    assert.equal(back.state.turn.id, t.turnId);
    assert.equal(back.state.turn.word, t.word);
    assert.equal(watcher.all('turn:end', (e) => e.turnId === t.turnId).length, 0);
    watcher.mark();
    back.send('draw:start', { c: '#000000', s: 5 });
    back.send('draw:pts', { p: [1, 1, 5, 5] });
    assert.ok(await watcher.waitFor('draw:pts'));
  } finally {
    await srv.stop();
  }
});

test('chủ phòng rớt mạng: chờ một lúc rồi chuyển quyền; quay lại sau đó thì không lấy lại quyền', async () => {
  const srv = await startServer();
  try {
    const cs = await makeRoom(srv, ['Chủ', 'B', 'C']);
    const [H, B] = cs;
    B.mark();
    H.drop();
    const st = await B.waitFor('room:state', (s) => s.hostId !== H.id, { timeout: 4000 });
    assert.ok([cs[1].id, cs[2].id].includes(st.hostId));
    assert.ok(B.all('chat:msg').some((m) => /giờ là chủ phòng/.test(m.text)));
    const H2 = await joinRoom(srv, cs[0].code, 'Chủ', { token: H.token });
    assert.equal(H2.id, H.id);
    assert.notEqual(H2.state.hostId, H.id);
    // chủ mới điều khiển được phòng
    const newHost = cs.find((c) => c.id === st.hostId);
    newHost.mark();
    newHost.send('host:settings', { settings: { rounds: 4 } });
    await newHost.waitFor('room:state', (s) => s.settings.rounds === 4);
  } finally {
    await srv.stop();
  }
});

test('chủ phòng tải lại trang nhanh: vẫn là chủ phòng', async () => {
  const srv = await startServer({ timing: { hostGrace: 30000 } }); // chờ chủ phòng 1,5 giây
  try {
    const cs = await makeRoom(srv, ['Chủ', 'B']);
    const [H, B] = cs;
    H.drop();
    const H2 = await joinRoom(srv, cs[0].code, 'Chủ', { token: H.token });
    await sleep(1800); // quá thời gian chờ chủ phòng (1,5 giây)
    assert.equal(H2.state.hostId, H.id);
    assert.equal(B.state.hostId, H.id);
  } finally {
    await srv.stop();
  }
});

test('trong trận còn 1 người kết nối: chờ một lúc rồi dừng; ai đó quay lại kịp thì chơi tiếp', async () => {
  const srv = await startServer({ timing: { lowPlayersGrace: 30000, drawerGrace: 30000 } }); // chờ 1,5 giây
  try {
    const cs = await makeRoom(srv, ['A', 'B'], { rounds: 2, drawTime: 120 });
    const [A, B] = cs;
    A.send('host:start');
    const t = await playTurn(cs);
    // B rớt rồi quay lại kịp
    B.drop();
    const B2 = await joinRoom(srv, A.code, 'B', { token: B.token });
    await sleep(1800);
    assert.notEqual(A.state.phase, 'lobby', 'quay lại kịp thì trận không bị huỷ');
    // B rớt hẳn
    A.mark();
    B2.drop();
    const st = await A.waitFor('room:state', (s) => s.phase === 'lobby', { timeout: 4000 });
    assert.equal(st.turn, null);
    assert.ok(A.all('chat:msg', () => true, A.cursor).some((m) => /Không đủ người chơi/.test(m.text)));
    assert.ok(t.turnId >= 1);
  } finally {
    await srv.stop();
  }
});

test('tất cả cùng rời đi: phòng đóng, mã phòng báo "đã đóng hoặc hết hạn"', async () => {
  const srv = await startServer();
  try {
    const cs = await makeRoom(srv, ['A', 'B']);
    const code = cs[0].code;
    for (const c of cs) { c.send('room:leave'); await c.waitFor('room:left'); }
    assert.equal(srv.lobby.rooms.size, 0);
    await assert.rejects(joinRoom(srv, code, 'C'), (e) => e.code === 'ROOM_EXPIRED');
  } finally {
    await srv.stop();
  }
});
