'use strict';
// Quản lý phòng qua mạng: mời ra, cấm, tắt chat, bỏ phiếu, chuyển chủ phòng, phòng đầy / sai mã / mật khẩu.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeRoom, createRoom, joinRoom, playTurn, sleep } = require('./helpers');

const errorOf = async (c, action) => { c.mark(); action(); return c.waitFor('error:action'); };

test('chủ phòng mời ra: người bị mời được báo, phải chờ hết thời gian mới vào lại được', async () => {
  const srv = await startServer({ timing: { kickCooldown: 20000 } }); // 20 giây × 0,05 = 1 giây
  try {
    const [H, B, C] = await makeRoom(srv, ['Chủ', 'B', 'C']);
    H.send('host:kick', { playerId: B.id });
    const k = await B.waitFor('kicked');
    assert.equal(k.code, 'KICKED');
    const st = await C.waitFor('room:state', (s) => s.players.length === 2, { since: 0 });
    assert.ok(!st.players.some((p) => p.id === B.id));
    await assert.rejects(joinRoom(srv, H.code, 'B', { token: B.token }), (e) => e.code === 'KICKED_RECENTLY');
    await sleep(1200);
    const back = await joinRoom(srv, H.code, 'B', { token: B.token });
    assert.ok(back.id);
  } finally {
    await srv.stop();
  }
});

test('chủ phòng cấm: không vào lại được nữa', async () => {
  const srv = await startServer();
  try {
    const [H, B] = await makeRoom(srv, ['Chủ', 'B', 'C']);
    H.send('host:ban', { playerId: B.id });
    assert.equal((await B.waitFor('kicked')).code, 'BANNED');
    await sleep(100);
    await assert.rejects(joinRoom(srv, H.code, 'B', { token: B.token }), (e) => e.code === 'BANNED');
  } finally {
    await srv.stop();
  }
});

test('tắt chat qua mạng: tin của người bị tắt không tới ai; bật lại thì bình thường', async () => {
  const srv = await startServer();
  try {
    const [H, B, C] = await makeRoom(srv, ['Chủ', 'B', 'C']);
    H.send('host:mute', { playerId: B.id, muted: true });
    await C.waitFor('room:state', (s) => s.players.find((p) => p.id === B.id)?.muted, { since: 0 });
    const since = C.mark();
    B.send('chat', { text: 'tin bị chặn' });
    const echo = await B.waitFor('chat:msg', (m) => m.text === 'tin bị chặn');
    assert.equal(echo.muted, true, 'người bị tắt chat vẫn thấy tin của mình (đánh dấu riêng)');
    H.send('host:mute', { playerId: B.id, muted: false });
    await C.waitFor('room:state', (s) => s.players.find((p) => p.id === B.id)?.muted === false);
    B.send('chat', { text: 'đã được nói lại' });
    await C.waitFor('chat:msg', (m) => m.text === 'đã được nói lại');
    assert.ok(!C.all('chat:msg', () => true, since).some((m) => m.text === 'tin bị chặn'));
  } finally {
    await srv.stop();
  }
});

test('bỏ phiếu mời ra: cần đủ phiếu, có đếm phiếu trong state; phòng 2 người không bỏ phiếu được', async () => {
  const srv = await startServer();
  try {
    const [A, B, C, D] = await makeRoom(srv, ['A', 'B', 'C', 'D']);
    A.send('vote:kick', { playerId: D.id });
    const st = await C.waitFor('room:state', (s) => s.players.find((p) => p.id === D.id)?.votes === 1, { since: 0 });
    assert.equal(st.players.find((p) => p.id === D.id).votesNeeded, 2);
    assert.equal((await errorOf(A, () => A.send('vote:kick', { playerId: D.id }))).code, 'ALREADY_VOTED');
    assert.equal((await errorOf(B, () => B.send('vote:kick', { playerId: B.id }))).code, 'SELF_ACTION');
    B.send('vote:kick', { playerId: D.id });
    assert.equal((await D.waitFor('kicked')).code, 'VOTE_KICKED');
    await assert.rejects(joinRoom(srv, A.code, 'D', { token: D.token }), (e) => e.code === 'BANNED');

    const [X, Y] = await makeRoom(srv, ['X', 'Y']);
    assert.equal((await errorOf(X, () => X.send('vote:kick', { playerId: Y.id }))).code, 'VOTE_UNAVAILABLE');
  } finally {
    await srv.stop();
  }
});

test('chỉ chủ phòng mới có quyền quản lý; chuyển quyền chủ phòng', async () => {
  const srv = await startServer();
  try {
    const [H, B, C] = await makeRoom(srv, ['Chủ', 'B', 'C']);
    for (const [ev, data] of [
      ['host:settings', { settings: { rounds: 5 } }], ['host:start', {}], ['host:kick', { playerId: C.id }],
      ['host:ban', { playerId: C.id }], ['host:mute', { playerId: C.id, muted: true }], ['host:transfer', { playerId: B.id }],
    ]) {
      const e = await errorOf(B, () => B.send(ev, data));
      assert.equal(e.code, 'NOT_HOST', ev);
      assert.ok(e.message && !/Error|stack/.test(e.message));
    }
    assert.equal((await errorOf(H, () => H.send('host:kick', { playerId: 'khongcoai' }))).code, 'INVALID_PLAYER');
    assert.equal((await errorOf(H, () => H.send('host:kick', { playerId: H.id }))).code, 'SELF_ACTION');
    H.send('host:transfer', { playerId: B.id });
    await C.waitFor('room:state', (s) => s.hostId === B.id, { since: 0 });
    assert.equal((await errorOf(H, () => H.send('host:start'))).code, 'NOT_HOST');
    B.mark();
    B.send('host:start');
    await B.waitFor('room:state', (s) => s.phase === 'roundStart');
  } finally {
    await srv.stop();
  }
});

test('cài đặt do chủ phòng đổi được đồng bộ cho cả phòng; không đổi được giữa trận', async () => {
  const srv = await startServer();
  try {
    const [H, B] = await makeRoom(srv, ['Chủ', 'B']);
    H.send('host:settings', { settings: { rounds: 4, drawTime: 90, wordCount: 5, hints: 1, wordMode: 'hidden', accentMode: 'strict', topics: ['do-an', 'dong-vat'], customWords: 'Cầu Rồng, Hồ Gươm, Phố cổ' } });
    const st = await B.waitFor('room:state', (s) => s.settings.rounds === 4, { since: 0 });
    assert.deepEqual(
      { r: st.settings.rounds, d: st.settings.drawTime, w: st.settings.wordCount, h: st.settings.hints, m: st.settings.wordMode, a: st.settings.accentMode, t: st.settings.topics },
      { r: 4, d: 90, w: 5, h: 1, m: 'hidden', a: 'strict', t: ['do-an', 'dong-vat'] },
    );
    assert.deepEqual(st.settings.customWords, [], 'khách không thấy nội dung từ tự thêm');
    assert.equal(st.settings.customWordCount, 3);
    H.mark();
    H.send('host:start');
    await H.waitFor('room:state', (s) => s.phase === 'roundStart');
    assert.equal((await errorOf(H, () => H.send('host:settings', { settings: { rounds: 1 } }))).code, 'INVALID_STATE');
    // chế độ ẩn từ: người đoán không nhận mặt nạ
    const t = await playTurn([H, B]);
    const g = t.guessers[0];
    const gs = await g.waitFor('room:state', (s) => s.phase === 'drawing', { since: 0 });
    assert.equal(gs.turn.mask, null);
    assert.equal(gs.turn.hidden, true);
    assert.equal(t.options.length, 5);
  } finally {
    await srv.stop();
  }
});

test('phòng đầy / sai mã / mã gõ chữ thường có khoảng trắng', async () => {
  const srv = await startServer();
  try {
    const [H] = await makeRoom(srv, ['Chủ', 'B'], { maxPlayers: 2 });
    await assert.rejects(joinRoom(srv, H.code, 'C'), (e) => e.code === 'ROOM_FULL');
    await assert.rejects(joinRoom(srv, 'ZZZZZZ', 'C'), (e) => e.code === 'ROOM_NOT_FOUND' && e.payload.notFound);
    // mã gõ thường / có khoảng trắng vẫn nhận ra
    const lower = await srv.client('lower');
    lower.send('room:join', { code: ` ${H.code.toLowerCase()} `, token: 'lower-token', profile: { name: 'Thường' } });
    assert.equal((await lower.waitFor('room:error')).code, 'ROOM_FULL');
  } finally {
    await srv.stop();
  }
});

test('phòng riêng có mật khẩu: thiếu / sai mật khẩu bị từ chối; đúng thì vào; nối lại không cần nhập lại', async () => {
  const srv = await startServer();
  try {
    const H = await createRoom(srv, 'Chủ', { isPrivate: true, password: 'bimat123' });
    const st = H.state;
    assert.equal(st.settings.hasPassword, true);
    assert.equal(st.settings.password, undefined, 'mật khẩu không bao giờ gửi xuống client');
    await assert.rejects(joinRoom(srv, H.code, 'B'), (e) => e.code === 'WRONG_PASSWORD' && e.payload.needPassword);
    await assert.rejects(joinRoom(srv, H.code, 'B', { password: 'sai' }), (e) => e.code === 'WRONG_PASSWORD');
    const B = await joinRoom(srv, H.code, 'B', { password: 'bimat123' });
    B.drop();
    const B2 = await joinRoom(srv, H.code, 'B', { token: B.token });
    assert.equal(B2.id, B.id);
  } finally {
    await srv.stop();
  }
});

test('voice chat: chỉ chuyển tín hiệu giữa người đang bật voice; bị tắt chat thì bị gỡ khỏi voice', async () => {
  const srv = await startServer();
  try {
    const [H, B, C] = await makeRoom(srv, ['Chủ', 'B', 'C']);
    const sdp = { type: 'offer', sdp: 'v=0' };
    H.send('voice:join', {});
    B.send('voice:join', {});
    await C.waitFor('room:state', (s) => s.players.filter((p) => p.voice).length === 2);
    H.send('voice:signal', { to: B.id, sdp });
    const sig = await B.waitFor('voice:signal');
    assert.equal(sig.from, H.id);
    assert.deepEqual(sig.sdp, sdp);
    // C chưa vào voice: không gửi được, cũng không nhận được
    const since = C.mark();
    C.send('voice:signal', { to: B.id, sdp });
    H.send('voice:signal', { to: C.id, sdp });
    await sleep(150);
    assert.equal(C.all('voice:signal', () => true, since).length, 0);
    H.send('host:mute', { playerId: B.id, muted: true });
    const st = await H.waitFor('room:state', (s) => s.players.find((p) => p.id === B.id).muted);
    assert.equal(st.players.find((p) => p.id === B.id).voice, false);
    assert.equal((await errorOf(B, () => B.send('voice:join', {}))).code, 'VOICE_MUTED');
  } finally {
    await srv.stop();
  }
});
