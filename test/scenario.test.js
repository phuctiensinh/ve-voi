'use strict';
// Kịch bản kiểm thử nhiều người chơi cùng lúc (mục 33 của yêu cầu), chạy liền một mạch trên cùng một phòng:
// phòng đầy → tải lại trang → đoán sai → spam → rớt mạng & nối lại → người vẽ rớt → chủ phòng rớt → mời ra → người mới vào giữa trận.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeRoom, joinRoom, playTurn, autoPlay, sleep } = require('./helpers');

test('kịch bản 3 người chơi: mọi tình huống mất kết nối & quản lý phòng trong một trận', async () => {
  // thời lượng × 0,1 (lượt vẽ 12 giây) để còn dư thời gian cho các bước rớt mạng / nối lại kể cả khi máy chậm
  const srv = await startServer({ timing: { scale: 0.1, kickCooldown: 200000 } });
  try {
    let [A, B, C] = await makeRoom(srv, ['An', 'Bình', 'Chi'], { maxPlayers: 3, rounds: 3, drawTime: 120 });
    const code = A.code;
    const live = () => [A, B, C].filter((c) => c && !c.closed);
    const by = (id) => live().find((c) => c.id === id);

    // 1) Phòng đầy: người thứ 4 bị từ chối
    await assert.rejects(joinRoom(srv, code, 'Dũng'), (e) => e.code === 'ROOM_FULL');

    // 2) Bắt đầu; lượt 1: người vẽ vẽ một nét
    A.send('host:start');
    let t = await playTurn(live());
    t.drawer.send('draw:start', { c: '#ff0000', s: 10 });
    t.drawer.send('draw:pts', { p: [100, 100, 200, 150, 300, 120] });
    t.drawer.send('draw:end');
    for (const g of t.guessers) await g.waitFor('draw:end');

    // 3) Tải lại trang một người đoán: giữ chỗ, nhận lại tranh và trạng thái
    const r1 = t.guessers[0];
    r1.drop();
    const r1b = await joinRoom(srv, code, r1.name, { token: r1.token });
    assert.equal(r1b.id, r1.id);
    assert.equal(r1b.state.phase, 'drawing');
    assert.equal(r1b.state.turn.word, null, 'tải lại trang không làm lộ từ');
    assert.equal((await r1b.waitFor('canvas:sync', () => true, { since: 0 })).actions.length, 1);
    if (r1 === A) A = r1b; else if (r1 === B) B = r1b; else C = r1b;

    // 4) Đoán sai: hiện như chat thường, không ai được điểm
    const [g1, g2] = live().filter((c) => c.id !== t.drawer.id);
    g1.send('chat', { text: 'con voi biển' });
    await g2.waitFor('chat:msg', (m) => m.text === 'con voi biển');
    assert.ok(g2.state.players.every((p) => p.score === 0));

    // 5) Spam chat: phần lớn bị chặn, người khác không bị ngập
    const since = g2.mark();
    for (let i = 0; i < 25; i++) g1.send('chat', { text: `spam số ${i}` });
    await sleep(250);
    assert.ok(g2.all('chat:msg', (m) => /^spam số/.test(m.text || ''), since).length <= 6);

    // 6) Một người đoán rớt mạng rồi nối lại: mọi người thấy trạng thái mất kết nối → kết nối lại
    t.drawer.mark();
    g2.drop();
    await t.drawer.waitFor('room:state', (s) => s.players.some((p) => p.id === g2.id && !p.connected));
    t.drawer.mark(); // chỉ xét các trạng thái sau khi đã thấy g2 mất kết nối
    const g2b = await joinRoom(srv, code, g2.name, { token: g2.token });
    await t.drawer.waitFor('room:state', (s) => s.players.every((p) => p.connected));
    if (g2 === A) A = g2b; else if (g2 === B) B = g2b; else C = g2b;

    // 7) Kết thúc lượt 1: cả hai đoán đúng (sau 4 giây để hết giới hạn chống spam)
    await sleep(4100);
    g1.send('chat', { text: t.word });
    g2b.send('chat', { text: t.word });
    const end1 = await t.drawer.waitFor('turn:end', (e) => e.turnId === t.turnId, { since: 0 });
    assert.equal(end1.reason, 'allGuessed');

    // 8) Lượt 2: người vẽ rớt mạng hẳn → bỏ lượt, trận đi tiếp; người đó quay lại sau
    t = await playTurn(live(), { after: t.turnId });
    const d2 = t.drawer;
    const watcher = t.guessers[0];
    d2.drop();
    const end2 = await watcher.waitFor('turn:end', (e) => e.turnId === t.turnId, { since: 0, timeout: 4000 });
    assert.equal(end2.reason, 'drawerLeft');
    const d2b = await joinRoom(srv, code, d2.name, { token: d2.token });
    assert.equal(d2b.id, d2.id);
    if (d2 === A) A = d2b; else if (d2 === B) B = d2b; else C = d2b;

    // 9) Chủ phòng rớt mạng → quyền chuyển cho người khác; quay lại không lấy lại quyền
    const hostId = A.id;
    const other = live().find((c) => c.id !== hostId);
    const sinceHost = other.mark();
    A.drop();
    const st9 = await other.waitFor('room:state', (s) => s.hostId !== hostId, { timeout: 4000 });
    const newHost = by(st9.hostId);
    assert.ok(newHost);
    const A2 = await joinRoom(srv, code, A.name, { token: A.token });
    assert.notEqual(A2.state.hostId, hostId);
    A = A2;
    assert.ok(other.all('chat:msg', (m) => /giờ là chủ phòng/.test(m.text), sinceHost).length >= 1);

    // 10) Chủ phòng mới mời một người ra; người đó không vào lại ngay được
    const victim = live().find((c) => c.id !== newHost.id);
    newHost.send('host:kick', { playerId: victim.id });
    assert.equal((await victim.waitFor('kicked')).code, 'KICKED');
    await assert.rejects(joinRoom(srv, code, victim.name, { token: victim.token }), (e) => e.code === 'KICKED_RECENTLY');

    // 11) Phòng không còn đầy: người mới vào giữa trận nhận đủ trạng thái, tranh vẽ và không thấy từ khoá
    const D = await joinRoom(srv, code, 'Dũng');
    const ds = D.state;
    assert.equal(ds.players.length, 3);
    assert.ok(ds.phase !== 'lobby');
    if (ds.phase === 'drawing') assert.equal(ds.turn.word, null);
    await D.waitFor('canvas:sync', () => true, { since: 0 });

    // 12) Trận vẫn chạy tới cuối và tổng kết được (người mới cũng được vẽ ở hiệp sau)
    const remaining = [newHost, ...live().filter((c) => c !== newHost && c !== victim), D].filter((c, i, arr) => arr.indexOf(c) === i && !c.closed);
    await autoPlay(remaining, { timeout: 30000 });
    const fin = await remaining[0].waitFor('game:end', () => true, { since: 0 });
    assert.equal(fin.ranking.length, 3);
    assert.ok(fin.ranking.some((r) => r.id === D.id));
  } finally {
    await srv.stop();
  }
});
