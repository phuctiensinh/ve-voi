'use strict';
// Không tin client: payload sai, sự kiện lạ, spam, gói tin quá lớn, khung WebSocket sai chuẩn,
// trang web lạ mở WebSocket, quá nhiều kết nối, đường dẫn HTTP độc hại, XSS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, makeRoom, connect, get, playTurn, sleep } = require('./helpers');

test('payload sai kiểu, sự kiện lạ, tên trùng thuộc tính Object, JSON hỏng: bị từ chối, máy chủ vẫn sống', async () => {
  const srv = await startServer();
  try {
    const [A, B] = await makeRoom(srv, ['A', 'B']);
    A.mark();
    for (const ev of ['constructor', 'valueOf', 'hasOwnProperty', '__proto__', 'toString', 'hack:server']) A.send(ev, { text: 'x' });
    A.send('chat', { text: 42 });
    A.send('chat', null);
    A.send('host:kick', { playerId: { $ne: 1 } });
    A.send('word:choose', { index: '0' });
    A.sendText('{khong phai json');
    A.sendText('"chuoi"');
    A.sendText(JSON.stringify({ e: 'x'.repeat(100), d: {} }));
    A.raw.write(A.frame(0x2, Buffer.from([1, 2, 3]))); // khung nhị phân
    await sleep(150);
    const errs = A.all('error:action', () => true, A.cursor);
    assert.ok(errs.length >= 9, `chỉ có ${errs.length} lỗi trả về`);
    assert.ok(errs.every((e) => e.code === 'BAD_PAYLOAD' && typeof e.message === 'string'));
    assert.ok(!A.closed, 'vài lỗi lặt vặt chưa tới mức bị ngắt');
    // máy chủ vẫn xử lý bình thường
    A.send('chat', { text: 'vẫn ổn' });
    await B.waitFor('chat:msg', (m) => m.text === 'vẫn ổn');
    const h = await get(srv.port, '/health');
    assert.equal(JSON.parse(h.body).ok, true);
  } finally {
    await srv.stop();
  }
});

test('gửi rác liên tục: vượt ngưỡng vi phạm thì bị ngắt kết nối (1008)', async () => {
  const srv = await startServer();
  try {
    const c = await srv.client('rac');
    for (let i = 0; i < 80; i++) c.sendText('rác');
    assert.equal(await c.waitClose(), 1008);
  } finally {
    await srv.stop();
  }
});

test('gói tin quá lớn (> 64 KB) → ngắt 1009; khung không mask → ngắt 1002', async () => {
  const srv = await startServer();
  try {
    const big = await srv.client('big');
    big.send('chat', { text: 'x'.repeat(70 * 1024) });
    assert.equal(await big.waitClose(), 1009);
    const unmasked = await srv.client('unmasked');
    unmasked.sendBytes(unmasked.frame(0x1, Buffer.from('{"e":"rooms:list"}'), { mask: false }));
    assert.equal(await unmasked.waitClose(), 1002);
  } finally {
    await srv.stop();
  }
});

test('spam chat: bị giới hạn tần suất, người khác chỉ nhận một phần, không ai bị lag', async () => {
  const srv = await startServer();
  try {
    const [A, B] = await makeRoom(srv, ['Spam', 'Nạn nhân']);
    const since = B.mark();
    A.mark();
    for (let i = 0; i < 40; i++) A.send('chat', { text: `spam ${i}` });
    A.send('ping:time', { t: 1 });
    await A.waitFor('error:action', (e) => e.code === 'RATE_LIMITED');
    await sleep(200);
    const got = B.all('chat:msg', (m) => m.type === 'chat' && /^spam/.test(m.text), since).length;
    assert.ok(got <= 6, `nạn nhân nhận tới ${got} tin spam`);
    assert.ok(A.all('chat:msg', (m) => m.type === 'private' && /chậm lại/.test(m.text), A.cursor).length >= 1);
    // chống gửi lặp nội dung
    await sleep(4200);
    B.mark();
    for (let i = 0; i < 4; i++) A.send('chat', { text: 'y hệt nhau' });
    await sleep(200);
    assert.equal(B.all('chat:msg', (m) => m.text === 'y hệt nhau', B.cursor).length, 2);
  } finally {
    await srv.stop();
  }
});

test('nét vẽ gửi dồn dập: phần vượt giới hạn bị bỏ qua lặng lẽ, không trả lỗi, không ngắt người vẽ', async () => {
  const srv = await startServer();
  try {
    const cs = await makeRoom(srv, ['Vẽ', 'Xem'], { rounds: 1, drawTime: 120 });
    cs[0].send('host:start');
    const t = await playTurn(cs);
    const since = t.guessers[0].mark();
    t.drawer.mark();
    t.drawer.send('draw:start', { c: '#000000', s: 4 });
    for (let i = 0; i < 400; i++) t.drawer.send('draw:pts', { p: [i % 800, i % 600] });
    t.drawer.send('draw:end');
    await t.guessers[0].waitFor('draw:end');
    const got = t.guessers[0].all('draw:pts', () => true, since).length;
    assert.ok(got >= 100 && got < 400, `nhận ${got} gói điểm`);
    assert.equal(t.drawer.all('error:action', () => true, t.drawer.cursor).length, 0);
    assert.ok(!t.drawer.closed);
  } finally {
    await srv.stop();
  }
});

test('WebSocket: chặn trang web lạ (Origin khác), sai đường dẫn, quá nhiều kết nối một IP', async () => {
  const srv = await startServer({ maxConnPerIp: 3 });
  try {
    await assert.rejects(connect(srv.port, { headers: { Origin: 'https://trang-la.example' } }), (e) => e.status === 403);
    await assert.rejects(connect(srv.port, { path: '/khong-phai-ws' }), (e) => e.status === 400);
    const same = await connect(srv.port, { headers: { Origin: `http://127.0.0.1:${srv.port}` } });
    const b = await connect(srv.port);
    const c = await connect(srv.port);
    await assert.rejects(connect(srv.port), (e) => e.status === 429);
    same.drop();
    await sleep(100);
    const d = await connect(srv.port);
    for (const x of [b, c, d]) x.drop();
  } finally {
    await srv.stop();
  }
  // Danh sách Origin cho phép (khi chạy sau tên miền riêng)
  const srv2 = await startServer({ allowedOrigins: ['https://vevoi.example'] });
  try {
    const ok = await connect(srv2.port, { headers: { Origin: 'https://vevoi.example' } });
    ok.drop();
    await assert.rejects(connect(srv2.port, { headers: { Origin: `http://127.0.0.1:${srv2.port}` } }), (e) => e.status === 403);
  } finally {
    await srv2.stop();
  }
});

test('tạo phòng hàng loạt từ một IP bị chặn (TOO_MANY_ROOMS)', async () => {
  const srv = await startServer();
  try {
    const codes = [];
    for (let i = 0; i < 7; i++) {
      const c = await srv.client(`tao${i}`);
      c.send('room:create', { token: `t${i}`, profile: { name: `P${i}` } });
      const r = await Promise.race([c.waitFor('room:joined'), c.waitFor('room:error')]);
      codes.push(r.code);
    }
    assert.ok(codes.slice(0, 5).every((x) => x && x.length === 6));
    assert.ok(codes.slice(5).every((x) => x === 'TOO_MANY_ROOMS'));
  } finally {
    await srv.stop();
  }
});

test('HTTP: header bảo mật, chặn đường dẫn độc hại, link mời /r/MÃ, trạng thái /health', async () => {
  const srv = await startServer();
  try {
    const home = await get(srv.port, '/');
    assert.equal(home.status, 200);
    assert.match(home.headers['content-security-policy'], /default-src 'self'/);
    assert.match(home.headers['content-security-policy'], /script-src 'self'(;|$)/, 'không cho script nội tuyến');
    assert.equal(home.headers['x-frame-options'], 'DENY');
    assert.equal(home.headers['x-content-type-options'], 'nosniff');
    const invite = await get(srv.port, '/r/ABC234');
    assert.equal(invite.status, 200);
    assert.equal(invite.body, home.body);
    for (const p of ['/%00', '/index.html%00.js', '/%E0%A4%A']) assert.equal((await get(srv.port, p)).status, 400, p);
    for (const p of ['/..%2f..%2fserver%2fgame.js', '/..%5c..%5cserver%5cgame.js']) assert.ok([403, 404].includes((await get(srv.port, p)).status), p);
    for (const p of ['/../server/game.js', '/%2e%2e/package.json', '/server/game.js', '/khong-co.js']) assert.equal((await get(srv.port, p)).status, 404, p);
    const health = JSON.parse((await get(srv.port, '/health')).body);
    assert.equal(health.ok, true);
    assert.equal(typeof health.rooms, 'number');
    // 304 khi trình duyệt đã có bản mới nhất
    const again = await get(srv.port, '/style.css', { 'If-None-Match': (await get(srv.port, '/style.css')).headers.etag });
    assert.equal(again.status, 304);
    // vẫn sống sau mọi thứ trên
    assert.equal((await get(srv.port, '/health')).status, 200);
  } finally {
    await srv.stop();
  }
});

test('XSS: tên & tin nhắn chứa HTML được giữ nguyên dạng chữ; giao diện luôn escape trước khi hiển thị', async () => {
  const srv = await startServer();
  try {
    const evil = '<img src=x onerror=alert(1)>';
    const [A, B] = await makeRoom(srv, [evil, 'B']);
    const st = await B.waitFor('room:state', (s) => s.players.length === 2, { since: 0 });
    assert.equal(st.players.find((p) => p.id === A.id).name, evil.slice(0, 16), 'máy chủ không biến đổi HTML, chỉ cắt độ dài');
    A.send('chat', { text: '<script>alert("xss")</script>\u0000\u202e' });
    const m = await B.waitFor('chat:msg', (x) => x.type === 'chat');
    assert.equal(m.text, '<script>alert("xss")</script>', 'bỏ ký tự điều khiển / đảo chiều chữ');
  } finally {
    await srv.stop();
  }
  // Hàm esc của giao diện
  const src = fs.readFileSync(path.join(__dirname, '../public/js/ui.js'), 'utf8');
  const body = src.match(/export const esc = (\(s\) => [^\n]+);/)[1];
  // eslint-disable-next-line no-new-func
  const esc = new Function(`return ${body}`)();
  assert.equal(esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});
