// Điểm vào: máy chủ HTTP (giao diện) + WebSocket (đồng bộ thời gian thực).
// Mọi sự kiện từ client đi qua MỘT cửa: kiểm tra schema → giới hạn tần suất → kiểm tra quyền → xử lý.
'use strict';
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { WSServer } = require('./ws');
const { Lobby } = require('./game');
const { validate, ERR, RATE } = require('./protocol');
const { Limiter } = require('./ratelimit');
const { createStatic } = require('./static');
const { fromEnv } = require('./config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
function makeLogger(level = 'info') {
  const max = LEVELS[level] ?? LEVELS.info;
  return (lvl, msg) => {
    if ((LEVELS[lvl] ?? LEVELS.info) > max) return;
    (lvl === 'error' ? console.error : console.log)(`[${new Date().toISOString()}] ${lvl.toUpperCase()} ${msg}`);
  };
}

// Sự kiện vẽ: không trả lỗi về (có thể là gói tin còn trên đường khi lượt vừa kết thúc), chỉ bỏ qua.
const SILENT = new Set(['draw:start', 'draw:pts', 'draw:end', 'draw:fill', 'draw:clear', 'draw:undo', 'draw:redo', 'canvas:resync', 'voice:signal']);

/**
 * Tạo máy chủ game (chưa listen).
 * @param {object} [options] ghi đè cấu hình môi trường: { timing, maxRooms, maxConnPerIp, trustProxy, allowedOrigins, logLevel, log }
 */
function createServer(options = {}) {
  const cfg = { ...fromEnv(), ...options };
  const log = options.log || makeLogger(cfg.logLevel);
  const timing = { ...(cfg.timing || {}) };
  if (!timing.scale) timing.scale = cfg.timeScale || 1;
  const serveStatic = createStatic(path.join(__dirname, '..', 'public'));

  const server = http.createServer((req, res) => {
    try { handleHttp(req, res); } catch (err) {
      log('error', `Lỗi khi phục vụ ${String(req.url).slice(0, 80)}: ${(err && err.stack) || err}`);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Máy chủ gặp lỗi, thử lại sau nhé.');
    }
  });
  function handleHttp(req, res) {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      let players = 0;
      for (const r of lobby.rooms.values()) players += r.players.size;
      res.end(JSON.stringify({ ok: true, rooms: lobby.rooms.size, players, connections: io.sockets.size, uptime: Math.round(process.uptime()) }));
      return;
    }
    serveStatic(req, res);
  }

  const io = new WSServer(server, {
    path: '/ws', maxConnPerIp: cfg.maxConnPerIp, trustProxy: cfg.trustProxy,
    allowedOrigins: cfg.allowedOrigins, heartbeatMs: cfg.heartbeatMs,
  });
  const lobby = new Lobby(io, { timing, maxRooms: cfg.maxRooms, log });
  const ipLimiter = new Limiter({ 'room:create': [0.1, 5], default: [1, 5] });

  const ctx = (socket) => {
    const room = socket.data.room;
    const player = room && !room.closed ? room.players.get(socket.data.playerId) : null;
    return player ? { room, player } : {};
  };
  const reply = (socket, code, extra = {}) => socket.emit('error:action', { code, message: ERR[code] || ERR.INVALID_STATE, ...extra });
  const roomError = (socket, code, extra = {}) => socket.emit('room:error', { code, error: ERR[code] || ERR.INVALID_STATE, ...extra });
  const leaveCurrent = (socket) => {
    const { room, player } = ctx(socket);
    if (room && player) room.removePlayer(player.id, 'leave');
    socket.data.room = null;
    socket.data.playerId = null;
  };

  // Sự kiện ngoài phòng
  const lobbyHandlers = {
    'rooms:list': (s) => s.emit('rooms:list', lobby.publicList()),
    'room:create': (s, d) => {
      if (!ipLimiter.take(`${s.ip}:create`, 'room:create')) return roomError(s, 'TOO_MANY_ROOMS');
      leaveCurrent(s);
      const room = lobby.create(d.settings || {});
      if (!room) return roomError(s, 'SERVER_BUSY');
      const r = room.addPlayer(s, { token: d.token, profile: d.profile, password: room.settings.password });
      if (r.error) roomError(s, r.error);
      return null;
    },
    'room:join': (s, d) => {
      const found = lobby.lookup(d.code);
      if (found.error) return roomError(s, found.error, { notFound: true });
      if (s.data.room && s.data.room !== found.room) leaveCurrent(s);
      const r = found.room.addPlayer(s, { token: d.token, profile: d.profile, password: d.password });
      if (r.error) roomError(s, r.error, { needPassword: !!r.needPassword });
      return null;
    },
    'room:quick': (s, d) => {
      leaveCurrent(s);
      const room = lobby.quickRoom();
      if (!room) return roomError(s, 'SERVER_BUSY');
      const r = room.addPlayer(s, { token: d.token, profile: d.profile });
      if (r.error) roomError(s, r.error);
      return null;
    },
    'room:leave': (s) => { leaveCurrent(s); s.emit('room:left', {}); },
  };

  // Sự kiện trong phòng: mỗi hàm trả về mã lỗi hoặc null
  const roomHandlers = {
    'host:settings': (r, p, d) => r.updateSettings(p, d.settings),
    'host:start': (r, p) => r.startGame(p),
    'host:stop': (r, p) => r.stopGame(p),
    'host:lobby': (r, p) => r.returnToLobby(p),
    'host:kick': (r, p, d) => r.kick(p, d.playerId),
    'host:ban': (r, p, d) => r.ban(p, d.playerId),
    'host:mute': (r, p, d) => r.setMute(p, d.playerId, d.muted),
    'host:transfer': (r, p, d) => r.transferHost(p, d.playerId),
    'vote:kick': (r, p, d) => r.voteKick(p, d.playerId),
    'word:choose': (r, p, d) => r.chooseWord(p, d),
    chat: (r, p, d) => r.chat(p, d.text),
    report: (r, p) => r.report(p),
    'draw:rate': (r, p, d) => r.rate(p, d.like),
    'draw:start': (r, p, d) => r.drawStart(p, d),
    'draw:pts': (r, p, d) => r.drawPoints(p, d),
    'draw:end': (r, p) => r.drawEnd(p),
    'draw:fill': (r, p, d) => r.drawFill(p, d),
    'draw:clear': (r, p) => r.drawClear(p),
    'draw:undo': (r, p) => r.drawUndo(p),
    'draw:redo': (r, p) => r.drawRedo(p),
    'canvas:resync': (r, p) => r.resync(p),
    'voice:join': (r, p) => r.voiceJoin(p),
    'voice:leave': (r, p) => r.voiceLeave(p),
    'voice:signal': (r, p, d) => r.voiceSignal(p, d),
  };

  io.on('handlerError', (err) => log('error', `Lỗi không mong đợi khi xử lý tin nhắn: ${(err && err.stack) || err}`));
  io.on('connection', (socket) => {
    socket.data.limiter = new Limiter(RATE, { maxKeys: 64 });
    socket.on('disconnect', () => {
      const { room, player } = ctx(socket);
      if (room && player && player.socket === socket) room.onDisconnect(player);
    });
  });

  io.on('message', (socket, event, data) => {
    try {
      if (!validate(event, data)) {
        socket.strike();
        if (!SILENT.has(event)) reply(socket, 'BAD_PAYLOAD', { event: String(event).slice(0, 40) });
        return;
      }
      if (!socket.data.limiter.take(event)) {
        socket.strike(0.2);
        if (!SILENT.has(event) && event !== 'ping:time') reply(socket, 'RATE_LIMITED', { event });
        return;
      }
      if (event === 'ping:time') { socket.emit('pong:time', { t: data.t, server: Date.now() }); return; }
      const d = data && typeof data === 'object' ? data : {};
      if (Object.hasOwn(lobbyHandlers, event)) { lobbyHandlers[event](socket, d); return; }
      const { room, player } = ctx(socket);
      if (!room) { if (!SILENT.has(event)) reply(socket, 'NOT_IN_ROOM', { event }); return; }
      const err = Object.hasOwn(roomHandlers, event) ? roomHandlers[event](room, player, d) : 'BAD_PAYLOAD';
      if (err) reply(socket, err, { event });
    } catch (e) {
      // Lỗi bất ngờ: ghi log đầy đủ phía server, người chơi chỉ nhận thông báo chung (không lộ stack trace)
      log('error', `Lỗi khi xử lý "${String(event).slice(0, 40)}": ${(e && e.stack) || e}`);
      try { reply(socket, 'INVALID_STATE', { event: String(event).slice(0, 40) }); } catch { /* socket đã đóng */ }
    }
  });

  return {
    server, io, lobby, log, config: cfg,
    listen(port = cfg.port, host = cfg.host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(server.address()); });
      });
    },
    close() {
      lobby.stop();
      io.close();
      return new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); });
    },
  };
}

function openBrowser(url) {
  const { spawn } = require('node:child_process');
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* không mở được thì thôi */ }
}

if (require.main === module) {
  const app = createServer();
  const { port, host, openBrowser: autoOpen } = app.config;
  app.listen(port, host).then(() => {
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    console.log('\n  VẼ VỜI đã sẵn sàng!');
    console.log(`   • Trên máy này:      http://localhost:${port}`);
    for (const ip of ips) console.log(`   • Bạn bè cùng Wi-Fi: http://${ip}:${port}`);
    console.log('   (Nhấn Ctrl + C hoặc đóng cửa sổ này để tắt máy chủ)\n');
    if (autoOpen) openBrowser(`http://localhost:${port}`);
  }).catch((err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Cổng ${port} đang được dùng. Có thể game đã chạy ở một cửa sổ khác.`);
      console.error(`  Thử mở http://localhost:${port} hoặc chạy với cổng khác (biến môi trường PORT).\n`);
      if (autoOpen) openBrowser(`http://localhost:${port}`);
    } else {
      console.error('Không khởi động được máy chủ:', err.message);
    }
    process.exit(1);
  });
  const shutdown = () => { app.log('info', 'Đang tắt máy chủ…'); app.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createServer, makeLogger };
