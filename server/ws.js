// Máy chủ WebSocket tối giản (RFC 6455) viết bằng Node.js thuần — không cần thư viện ngoài.
// Cung cấp mô hình sự kiện kiểu Socket.io: socket.on(evt), socket.emit(evt, data), phòng (rooms).
'use strict';
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Socket extends EventEmitter {
  constructor(server, rawSocket, req, ip) {
    super();
    this.server = server;
    this.raw = rawSocket;
    this.id = crypto.randomBytes(8).toString('hex');
    this.ip = ip;
    this.rooms = new Set();
    this.alive = true;
    this.closed = false;
    this.data = {};
    this.violations = 0;
    this._buf = Buffer.alloc(0);
    this._frag = null;
    rawSocket.setNoDelay(true);
    rawSocket.on('data', (chunk) => this._onData(chunk));
    rawSocket.on('close', () => this._onClose());
    rawSocket.on('error', () => this._onClose());
    // Máy chủ HTTP để socket ở chế độ "half-open": phía kia đóng TCP mà không gửi khung đóng
    // (tab bị tắt đột ngột, app bị hệ điều hành dừng) thì phải tự đóng, nếu không sẽ chờ tới nhịp tim mới biết.
    rawSocket.on('end', () => { if (!this.closed) { rawSocket.end(); this._onClose(); } });
  }

  // ---------- API công khai ----------
  emit(event, data) {
    if (event === 'disconnect') return super.emit(event, data);
    this.sendRaw(JSON.stringify({ e: event, d: data }));
    return true;
  }
  sendRaw(str) {
    if (this.closed) return;
    this._writeFrame(0x1, Buffer.from(str, 'utf8'));
  }
  join(room) { this.rooms.add(room); this.server._join(room, this); }
  leave(room) { this.rooms.delete(room); this.server._leave(room, this); }
  to(room) { return this.server.to(room, this); }
  /** Ghi nhận hành vi bất thường; quá ngưỡng thì ngắt kết nối. */
  strike(n = 1) {
    this.violations += n;
    if (this.violations > this.server.maxViolations) this.close(1008);
  }
  close(code = 1000) {
    if (this.closed) return;
    const b = Buffer.alloc(2); b.writeUInt16BE(code, 0);
    this._writeFrame(0x8, b);
    this.raw.end();
    this._onClose();
  }

  // ---------- Khung (frame) ----------
  _writeFrame(opcode, payload) {
    const len = payload.length;
    let header;
    if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    header[0] = 0x80 | opcode;
    try { this.raw.write(Buffer.concat([header, payload])); } catch { this._onClose(); }
  }

  _onData(chunk) {
    const max = this.server.maxPayload;
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    if (this._buf.length > max + 14) { this.close(1009); return; }
    while (!this.closed) {
      if (this._buf.length < 2) return;
      const b0 = this._buf[0], b1 = this._buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (this._buf.length < 4) return; len = this._buf.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (this._buf.length < 10) return;
        const big = this._buf.readBigUInt64BE(2);
        if (big > BigInt(max)) { this.close(1009); return; }
        len = Number(big); off = 10;
      }
      if (!masked) { this.close(1002); return; } // client bắt buộc phải mask
      if (len > max) { this.close(1009); return; }
      if (this._buf.length < off + 4 + len) return;
      const mask = this._buf.subarray(off, off + 4);
      const payload = Buffer.from(this._buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this._buf = this._buf.subarray(off + 4 + len);
      this._handleFrame(fin, opcode, payload);
    }
  }

  _handleFrame(fin, opcode, payload) {
    switch (opcode) {
      case 0x0: // khung nối tiếp
        if (!this._frag) { this.close(1002); return; }
        this._frag.push(payload);
        if (this._frag.reduce((s, p) => s + p.length, 0) > this.server.maxPayload) { this.close(1009); return; }
        if (fin) { const full = Buffer.concat(this._frag); this._frag = null; this._onMessage(full); }
        return;
      case 0x1: // text
        if (!fin) { this._frag = [payload]; return; }
        this._onMessage(payload);
        return;
      case 0x2: this.strike(); return; // nhị phân: không dùng
      case 0x8: this.close(1000); return;
      case 0x9: this._writeFrame(0xA, payload); return; // ping → pong
      case 0xA: this.alive = true; return; // pong
      default: this.close(1002);
    }
  }

  _onMessage(buf) {
    this.alive = true;
    let msg;
    try { msg = JSON.parse(buf.toString('utf8')); } catch { this.strike(); return; }
    if (!msg || typeof msg !== 'object' || typeof msg.e !== 'string' || msg.e.length > 40) { this.strike(); return; }
    try { this.server.emit('message', this, msg.e, msg.d); } catch (err) { this.server.emit('handlerError', err, this); }
  }

  _onClose() {
    if (this.closed) return;
    this.closed = true;
    for (const r of this.rooms) this.server._leave(r, this);
    this.rooms.clear();
    this.server._forget(this);
    super.emit('disconnect');
  }
}

class Broadcaster {
  constructor(server, room, except) { this.server = server; this.room = room; this.except = except; }
  emit(event, data) {
    const set = this.server.rooms.get(this.room);
    if (!set) return;
    const str = JSON.stringify({ e: event, d: data });
    for (const s of set) if (s !== this.except) s.sendRaw(str);
  }
}

class WSServer extends EventEmitter {
  /**
   * @param {import('node:http').Server} httpServer
   * @param {{path?:string, maxPayload?:number, heartbeatMs?:number, maxConnPerIp?:number,
   *          trustProxy?:boolean, allowedOrigins?:string[], maxViolations?:number}} opts
   */
  constructor(httpServer, opts = {}) {
    super();
    this.path = opts.path || '/ws';
    this.maxPayload = opts.maxPayload || 64 * 1024;
    this.maxConnPerIp = opts.maxConnPerIp || 40;
    this.maxViolations = opts.maxViolations || 50;
    this.trustProxy = !!opts.trustProxy;
    this.allowedOrigins = opts.allowedOrigins || [];
    this.sockets = new Set();
    this.rooms = new Map();
    this.perIp = new Map();
    httpServer.on('upgrade', (req, raw, head) => this._upgrade(req, raw, head));
    this._hb = setInterval(() => {
      for (const s of this.sockets) {
        if (!s.alive) { s.raw.destroy(); s._onClose(); continue; }
        s.alive = false;
        s._writeFrame(0x9, Buffer.alloc(0));
      }
    }, opts.heartbeatMs || 10000);
    this._hb.unref();
  }

  clientIp(req) {
    if (this.trustProxy) {
      const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (fwd) return fwd;
    }
    return req.socket.remoteAddress || 'unknown';
  }

  /** Chặn trang web lạ mở WebSocket tới máy chủ (cross-site WebSocket hijacking). */
  originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // công cụ không phải trình duyệt (test, bot) không gửi Origin
    if (this.allowedOrigins.length) return this.allowedOrigins.includes(origin);
    try {
      const originHost = new URL(origin).host;
      if (originHost === req.headers.host || originHost.endsWith('.vercel.app')) return true;
      return false;
    } catch { return false; }
  }

  _reject(raw, status, text) {
    raw.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  }

  _upgrade(req, raw, head) {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== this.path || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') return this._reject(raw, 400, 'Bad Request');
    if (!this.originAllowed(req)) return this._reject(raw, 403, 'Forbidden');
    const ip = this.clientIp(req);
    if ((this.perIp.get(ip) || 0) >= this.maxConnPerIp) return this._reject(raw, 429, 'Too Many Requests');
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    raw.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const socket = new Socket(this, raw, req, ip);
    this.sockets.add(socket);
    this.perIp.set(ip, (this.perIp.get(ip) || 0) + 1);
    this.emit('connection', socket);
    if (head && head.length) socket._onData(head); // khung gửi kèm ngay sau bắt tay
  }

  _forget(socket) {
    if (!this.sockets.delete(socket)) return;
    const n = (this.perIp.get(socket.ip) || 1) - 1;
    if (n <= 0) this.perIp.delete(socket.ip); else this.perIp.set(socket.ip, n);
  }

  to(room, except) { return new Broadcaster(this, room, except); }
  _join(room, s) { if (!this.rooms.has(room)) this.rooms.set(room, new Set()); this.rooms.get(room).add(s); }
  _leave(room, s) {
    const set = this.rooms.get(room);
    if (!set) return;
    set.delete(s);
    if (!set.size) this.rooms.delete(room);
  }
  close() { clearInterval(this._hb); for (const s of [...this.sockets]) s.close(1001); }
}

module.exports = { WSServer };
