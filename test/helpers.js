// Tiện ích kiểm thử: chạy máy chủ thật trên cổng ngẫu nhiên + client WebSocket tối giản
// (tự viết theo RFC 6455 để chạy được trên mọi bản Node ≥ 18, không cần thư viện ngoài).
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { createServer } = require('../server/index');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Điều kiện chờ bị lỗi (ví dụ đọc thuộc tính của người chơi chưa vào phòng) thì coi như chưa thoả. */
const safe = (pred, d) => { try { return !!pred(d); } catch { return false; } };

class Client {
  constructor(raw, name) {
    this.raw = raw;
    this.name = name;
    this.log = [];        // mọi gói tin nhận được, theo thứ tự: { e, d }
    this.cursor = 0;      // waitFor mặc định chỉ xét gói tin từ vị trí này (đặt bằng mark())
    this.closed = false;
    this.closeCode = null;
    this.buf = Buffer.alloc(0);
    this.waiters = new Set();
    this.closeWaiters = [];
    raw.setNoDelay(true);
    raw.on('data', (c) => this.onData(c));
    raw.on('close', () => this.onClose());
    raw.on('error', () => this.onClose());
  }

  // ───── gửi ─────
  frame(opcode, payload, { mask = true } = {}) {
    const body = Buffer.from(payload);
    const len = body.length;
    let header;
    if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    header[0] = 0x80 | opcode;
    if (!mask) return Buffer.concat([header, body]);
    header[1] |= 0x80;
    const key = crypto.randomBytes(4);
    for (let i = 0; i < len; i++) body[i] ^= key[i & 3];
    return Buffer.concat([header, key, body]);
  }
  send(e, d) { this.sendText(JSON.stringify({ e, d })); }
  sendText(text) { if (!this.closed) this.raw.write(this.frame(1, Buffer.from(text, 'utf8'))); }
  sendBytes(buf) { if (!this.closed) this.raw.write(buf); }

  // ───── nhận ─────
  onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < 2) return;
      const op = this.buf[0] & 0x0f;
      let len = this.buf[1] & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const payload = this.buf.subarray(off, off + len);
      this.buf = this.buf.subarray(off + len);
      if (op === 0x1) {
        const m = JSON.parse(payload.toString('utf8'));
        this.push(m.e, m.d);
      } else if (op === 0x8) {
        this.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        this.raw.end();
      } else if (op === 0x9) {
        this.raw.write(this.frame(0xA, payload));
      }
    }
  }
  push(e, d) {
    this.log.push({ e, d });
    for (const w of [...this.waiters]) {
      if (w.e === e && safe(w.pred, d)) { this.waiters.delete(w); clearTimeout(w.timer); w.resolve(d); }
    }
  }
  onClose() {
    if (this.closed) return;
    this.closed = true;
    for (const w of [...this.waiters]) { clearTimeout(w.timer); w.reject(new Error(`[${this.name}] kết nối đã đóng khi đang chờ "${w.e}"`)); }
    this.waiters.clear();
    this.closeWaiters.forEach((fn) => fn(this.closeCode));
  }

  /** Đánh dấu: các lần waitFor sau chỉ xét gói tin nhận từ bây giờ. */
  mark() { this.cursor = this.log.length; return this.cursor; }

  /** Chờ gói tin `e` thoả `pred` (xét cả gói đã nhận kể từ `since`). */
  waitFor(e, pred = () => true, { since = this.cursor, timeout = 4000 } = {}) {
    for (let i = since; i < this.log.length; i++) {
      const m = this.log[i];
      if (m.e === e && safe(pred, m.d)) return Promise.resolve(m.d);
    }
    if (this.closed) return Promise.reject(new Error(`[${this.name}] kết nối đã đóng, không chờ được "${e}"`));
    return new Promise((resolve, reject) => {
      const w = { e, pred, resolve, reject, timer: null };
      w.timer = setTimeout(() => {
        this.waiters.delete(w);
        reject(new Error(`[${this.name}] hết ${timeout}ms mà chưa nhận "${e}" như mong đợi`));
      }, timeout);
      this.waiters.add(w);
    });
  }
  /** Các gói tin `e` đã nhận (kể từ `since`, mặc định từ đầu). */
  all(e, pred = () => true, since = 0) { return this.log.slice(since).filter((m) => m.e === e && pred(m.d)).map((m) => m.d); }
  /** room:state mới nhất. */
  get state() { for (let i = this.log.length - 1; i >= 0; i--) if (this.log[i].e === 'room:state') return this.log[i].d; return null; }
  /** Toàn bộ dữ liệu đã nhận dưới dạng chuỗi (để quét rò rỉ từ khoá). */
  dump(since = 0) { return this.log.slice(since).map((m) => JSON.stringify(m)).join('\n'); }

  waitClose(timeout = 4000) {
    if (this.closed) return Promise.resolve(this.closeCode);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`[${this.name}] kết nối chưa bị đóng sau ${timeout}ms`)), timeout);
      this.closeWaiters.push((code) => { clearTimeout(t); resolve(code); });
    });
  }
  /** Đóng lịch sự (như đóng tab). */
  close() { if (!this.closed) { this.raw.write(this.frame(0x8, Buffer.from([0x03, 0xe8]))); this.raw.end(); } }
  /** Rớt mạng đột ngột (không gửi khung đóng). */
  drop() { this.raw.destroy(); this.onClose(); }
}

/** Mở kết nối WebSocket tới máy chủ test. Từ chối → Error có `status` (400/403/429…). */
function connect(port, { name = 'client', headers = {}, path = '/ws' } = {}) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: '127.0.0.1', port, path,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key, ...headers },
    });
    req.on('upgrade', (res, socket, head) => {
      const expected = crypto.createHash('sha1').update(key + GUID).digest('base64');
      if (res.headers['sec-websocket-accept'] !== expected) { socket.destroy(); reject(new Error('Sai Sec-WebSocket-Accept')); return; }
      const c = new Client(socket, name);
      if (head && head.length) c.onData(head);
      resolve(c);
    });
    req.on('response', (res) => { res.resume(); reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })); });
    req.on('error', reject);
    req.end();
  });
}

/** GET đơn giản: trả về { status, headers, body }. */
function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

/**
 * Khởi động máy chủ thật trên cổng ngẫu nhiên.
 * Mặc định mọi thời lượng nhân 0.05 (lượt vẽ 80 giây → 4 giây) để test chạy nhanh.
 */
async function startServer(options = {}) {
  const app = createServer({ log: () => {}, maxConnPerIp: 1000, maxRooms: 1000, ...options, timing: { scale: 0.05, ...(options.timing || {}) } });
  const { port } = await app.listen(0, '127.0.0.1');
  const clients = [];
  let n = 0;
  const srv = {
    app, port, lobby: app.lobby,
    async client(name = `c${++n}`, opts = {}) { const c = await connect(port, { name, ...opts }); clients.push(c); return c; },
    async stop() { for (const c of clients) if (!c.closed) c.drop(); await app.close(); },
  };
  return srv;
}

const profile = (name, face = 0, color = 0) => ({ name, avatar: { face, color } });
const newToken = () => crypto.randomBytes(9).toString('hex');

/** Tạo phòng, chờ vào xong. Client trả về có thêm id, code, token. */
async function createRoom(srv, name, settings = {}) {
  const c = await srv.client(name);
  c.token = newToken();
  c.send('room:create', { token: c.token, profile: profile(name), settings });
  const joined = await c.waitFor('room:joined');
  Object.assign(c, { id: joined.you, code: joined.code });
  await c.waitFor('room:state');
  return c;
}

/** Vào phòng có sẵn. `token` để giả lập tải lại trang / nối lại. Lỗi → ném Error có code. */
async function joinRoom(srv, code, name, { token = newToken(), password } = {}) {
  const c = await srv.client(name);
  c.token = token;
  c.send('room:join', { code, token, profile: profile(name), ...(password !== undefined ? { password } : {}) });
  const first = await Promise.race([c.waitFor('room:joined'), c.waitFor('room:error')]);
  if (first.error) { const err = new Error(first.error); err.code = first.code; err.payload = first; err.client = c; throw err; }
  Object.assign(c, { id: first.you, code: first.code });
  await c.waitFor('room:state');
  return c;
}

/** Tạo phòng với host + những người còn lại. */
async function makeRoom(srv, names, settings = {}) {
  const host = await createRoom(srv, names[0], settings);
  const others = [];
  for (const n of names.slice(1)) others.push(await joinRoom(srv, host.code, n));
  const all = [host, ...others];
  await host.waitFor('room:state', (s) => s.players.length === all.length);
  return all;
}

/**
 * Chờ lượt chọn từ có id > `after`; người vẽ chọn từ thứ `index`.
 * Trả về { turnId, drawer, word, options, guessers }.
 */
async function playTurn(clients, { index = 0, after = 0, watcher } = {}) {
  const w = watcher || clients.find((c) => !c.closed);
  const choosing = await w.waitFor('room:state', (s) => s.phase === 'choosing' && s.turn.id > after, { since: 0, timeout: 8000 });
  const turnId = choosing.turn.id;
  const drawer = clients.find((c) => c.id === choosing.turn.drawerId && !c.closed);
  if (!drawer) throw new Error(`Không tìm thấy client của người vẽ ${choosing.turn.drawerId}`);
  const opts = await drawer.waitFor('turn:options', (o) => o.turnId === turnId, { since: 0 });
  drawer.send('word:choose', { index });
  const st = await drawer.waitFor('room:state', (s) => s.phase === 'drawing' && s.turn.id === turnId, { since: 0 });
  return { turnId, drawer, word: st.turn.word, options: opts.options, guessers: clients.filter((c) => c !== drawer && !c.closed) };
}

/**
 * "Người chơi máy": tự chọn từ và cho mọi người đoán đúng cho tới khi `until(state)` thoả (mặc định: hết trận).
 * Dùng khi chỉ cần trận chạy tiếp, không quan tâm chi tiết từng lượt.
 */
async function autoPlay(clients, { until = (s) => s.phase === 'gameEnd', timeout = 20000 } = {}) {
  const start = Date.now();
  const done = new Set();
  while (Date.now() - start < timeout) {
    const live = clients.filter((c) => !c.closed && c.state);
    const st = live[0]?.state;
    if (st && until(st)) return st;
    const drawer = st?.turn && live.find((c) => c.id === st.turn.drawerId);
    if (drawer && st.phase === 'choosing' && !done.has(`c${st.turn.id}`)) {
      done.add(`c${st.turn.id}`);
      drawer.send('word:choose', { index: 0 });
    }
    const word = drawer?.state?.phase === 'drawing' && drawer.state.turn.word;
    if (word && !done.has(`d${st.turn.id}`)) {
      done.add(`d${st.turn.id}`);
      for (const g of live) if (g !== drawer) g.send('chat', { text: word });
    }
    await sleep(40);
  }
  throw new Error('autoPlay: trận không đi tới trạng thái mong đợi');
}

module.exports = { Client, connect, get, startServer, createRoom, joinRoom, makeRoom, playTurn, autoPlay, profile, newToken, sleep };
