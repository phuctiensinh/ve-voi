// Lõi game: phòng chơi, máy trạng thái lượt chơi, đoán chữ, tính điểm, quản lý phòng, đồng bộ canvas.
// Server giữ toàn quyền: client chỉ gửi ý định, mọi kết quả do server quyết định rồi phát lại.
'use strict';
const crypto = require('node:crypto');
const { judgeGuess, makeMask, lengthInfo, letterIndexes, clean, strictKey } = require('./vietnamese');
const { pickOptions, TOPICS, DEFAULT_TOPICS } = require('./words');
const { DIFFICULTY, guesserPoints, drawerPoints, REPORT_PENALTY } = require('./scoring');
const { Board, W: CW, H: CH } = require('./board');
const { ERR } = require('./protocol');

/** Thời lượng mặc định (ms). `scale` nhân với mọi thời lượng — test dùng để chạy nhanh. */
const DEFAULT_TIMING = {
  choose: 15000,          // người vẽ chọn từ
  roundIntro: 2500,       // màn "Hiệp N"
  turnEnd: 6000,          // màn công bố đáp án
  gameEnd: 25000,         // màn tổng kết trước khi tự về phòng chờ
  reconnectGrace: 45000,  // giữ chỗ cho người rớt mạng
  drawerGrace: 12000,     // chờ người vẽ nối lại trước khi bỏ lượt
  hostGrace: 10000,       // chờ chủ phòng nối lại trước khi chuyển quyền
  lowPlayersGrace: 12000, // trong trận còn dưới 2 người kết nối: chờ trước khi dừng
  kickCooldown: 60000,    // bị mời ra thì phải chờ mới vào lại
  roomIdle: 30 * 60000,   // phòng chờ không hoạt động → đóng
  scale: 1,
};

/** Máy trạng thái: lobby (WAITING) → roundStart (NEXT_ROUND) → choosing → drawing → turnEnd (ROUND_END) → … → gameEnd. */
const TRANSITIONS = {
  lobby: ['roundStart'],
  roundStart: ['choosing', 'roundStart', 'gameEnd', 'lobby'],
  choosing: ['drawing', 'turnEnd', 'lobby'],
  drawing: ['turnEnd', 'lobby'],
  turnEnd: ['choosing', 'roundStart', 'gameEnd', 'lobby'],
  gameEnd: ['lobby', 'roundStart'],
};
const IN_GAME = new Set(['roundStart', 'choosing', 'drawing', 'turnEnd']);

const LIMITS = { maxPlayers: [2, 12], rounds: [1, 10], drawTime: [30, 120], wordCount: [1, 5], hints: [0, 5] };
const DEFAULT_SETTINGS = {
  name: 'Phòng vẽ vui',
  maxPlayers: 8,
  rounds: 3,
  drawTime: 80,
  wordCount: 3,
  hints: 2,
  wordMode: 'normal',      // 'normal' | 'hidden' (ẩn độ dài từ, không gợi ý)
  accentMode: 'loose',     // 'loose' (không dấu cũng được) | 'strict' (phải đúng dấu)
  language: 'vi',
  isPrivate: false,
  password: '',
  topics: DEFAULT_TOPICS,
  customWords: [],
  customOnly: false,
};
const AVATAR_FACES = 16, AVATAR_COLORS = 12;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLOR_RE = /^#[0-9a-f]{6}$/i;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const int = (v, d) => (Number.isFinite(+v) ? Math.round(+v) : d);

function sanitizeText(s, max) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\ufeff]/g, '').normalize('NFC')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Kiểm tra & chuẩn hoá cài đặt phòng. Không tin bất kỳ giá trị nào từ client. */
function sanitizeSettings(input = {}, base = DEFAULT_SETTINGS) {
  const s = { ...base };
  let rejectedWords = 0;
  const num = (k) => { if (k in input) s[k] = clamp(int(input[k], base[k]), ...LIMITS[k]); };
  if ('name' in input) s.name = sanitizeText(input.name, 30) || DEFAULT_SETTINGS.name;
  num('maxPlayers'); num('rounds'); num('wordCount'); num('hints');
  if ('drawTime' in input) s.drawTime = clamp(Math.round(int(input.drawTime, base.drawTime) / 10) * 10, ...LIMITS.drawTime);
  if ('wordMode' in input) s.wordMode = input.wordMode === 'hidden' ? 'hidden' : 'normal';
  if ('accentMode' in input) s.accentMode = input.accentMode === 'strict' ? 'strict' : 'loose';
  if ('isPrivate' in input) s.isPrivate = !!input.isPrivate;
  if ('password' in input) s.password = sanitizeText(input.password, 20);
  if (!s.isPrivate) s.password = '';
  if ('topics' in input && Array.isArray(input.topics)) {
    const t = [...new Set(input.topics.filter((x) => typeof x === 'string' && Object.hasOwn(TOPICS, x)))];
    s.topics = t.length ? t : DEFAULT_TOPICS;
  }
  if ('customWords' in input) {
    const raw = Array.isArray(input.customWords) ? input.customWords : String(input.customWords || '').split(/[,\n]/);
    const seen = new Set(), out = [];
    for (const r of raw) {
      const w = sanitizeText(r, 40);
      if (!w) continue;
      if (w.length > 32 || !/^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u.test(w) || !/\p{L}/u.test(w)) { rejectedWords++; continue; }
      const key = strictKey(w);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(w);
    }
    if (out.length > 200) rejectedWords += out.length - 200;
    s.customWords = out.slice(0, 200);
  }
  if ('customOnly' in input) s.customOnly = !!input.customOnly;
  if (s.customWords.length < 3) s.customOnly = false;
  s.language = 'vi';
  return { settings: s, rejectedWords };
}

function sanitizeProfile(p = {}) {
  return {
    name: sanitizeText(p?.name, 16) || 'Hoạ sĩ ẩn danh',
    avatar: {
      face: clamp(int(p?.avatar?.face, 0), 0, AVATAR_FACES - 1),
      color: clamp(int(p?.avatar?.color, 0), 0, AVATAR_COLORS - 1),
    },
  };
}

/** Lịch gợi ý: mốc thời gian (ms tính từ lúc bắt đầu vẽ). Không bao giờ mở quá nửa số chữ. */
function hintPlan(word, hints, drawMs, wordMode = 'normal') {
  if (wordMode === 'hidden' || hints <= 0) return [];
  const count = Math.min(hints, Math.floor(letterIndexes(word).length / 2));
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, k) =>
    Math.round(drawMs * (count === 1 ? 0.6 : 0.45 + (0.4 * k) / (count - 1))));
}

class Room {
  /**
   * @param {{code:string, io:any, settings?:object, timing?:object, onEmpty?:Function, log?:Function, rand?:Function}} opts
   */
  constructor({ code, io, settings, timing, onEmpty, log, rand }) {
    this.code = code;
    this.io = io;
    this.channel = 'room:' + code;
    this.timing = { ...DEFAULT_TIMING, ...(timing || {}) };
    this.settings = sanitizeSettings(settings || {}).settings;
    this.onEmpty = onEmpty;
    this.log = log || (() => {});
    this.rand = rand || Math.random;
    this.players = new Map();
    this.hostId = null;
    this.banned = new Set();
    this.kicked = new Map();      // token → thời điểm được vào lại
    this.votes = new Map();       // targetId → Set(voterId)
    this.phase = 'lobby';
    this.phaseEndsAt = 0;
    this.phaseMs = 0;
    this.round = 0;
    this.turn = null;
    this.turnSeq = 0;
    this.queue = [];
    this.used = new Set();          // từ đã được chọn để vẽ trong trận
    this.seen = new Set();          // từ đã từng được đưa ra cho người vẽ chọn
    this.board = new Board();
    this.timers = { phase: null, hints: [], drawerGrace: null, hostGrace: null, lowPlayers: null };
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.closed = false;
  }

  ms(key) { return Math.max(1, Math.round(this.timing[key] * this.timing.scale)); }
  drawMs() { return Math.max(1, Math.round(this.settings.drawTime * 1000 * this.timing.scale)); }
  touch() { this.lastActivity = Date.now(); }

  /** Hẹn giờ an toàn: lỗi trong callback được ghi log và phòng được đưa về trạng thái hợp lệ. */
  later(fn, ms) {
    return setTimeout(() => {
      if (this.closed) return;
      try { fn(); } catch (err) { this.recover(err); }
    }, ms);
  }
  setPhaseTimer(fn, ms) { clearTimeout(this.timers.phase); this.timers.phase = this.later(fn, ms); this.phaseEndsAt = Date.now() + ms; this.phaseMs = ms; }
  clearGameTimers() {
    clearTimeout(this.timers.phase); this.timers.phase = null;
    this.timers.hints.forEach(clearTimeout); this.timers.hints = [];
    clearTimeout(this.timers.drawerGrace); this.timers.drawerGrace = null;
    clearTimeout(this.timers.lowPlayers); this.timers.lowPlayers = null;
  }
  setPhase(next) {
    if (!TRANSITIONS[this.phase] || !TRANSITIONS[this.phase].includes(next)) {
      throw new Error(`Chuyển trạng thái không hợp lệ: ${this.phase} → ${next}`);
    }
    this.phase = next;
  }
  recover(err) {
    this.log('error', `[phòng ${this.code}] lỗi nội bộ, đưa về phòng chờ: ${(err && err.stack) || err}`);
    this.clearGameTimers();
    this.phase = 'lobby';
    this.turn = null;
    this.queue = [];
    this.phaseEndsAt = 0;
    this.phaseMs = 0;
    this.board.reset();
    this.emitAll('canvas:sync', this.board.snapshot());
    this.system('Có lỗi xảy ra nên trận đấu dừng lại. Chủ phòng có thể bắt đầu lại.', 'warn');
    this.broadcastState();
  }

  // ════════════════ Người chơi ════════════════
  get connectedPlayers() { return [...this.players.values()].filter((p) => p.connected); }
  get inGame() { return IN_GAME.has(this.phase); }

  /** Thêm người chơi (hoặc nối lại theo token). Trả về { player } hoặc { error, needPassword }. */
  addPlayer(socket, { token, profile, password }) {
    const existing = token && [...this.players.values()].find((p) => p.token === token);
    if (existing) return this.reattach(existing, socket, profile);
    if (token && this.banned.has(token)) return { error: 'BANNED' };
    const until = token && this.kicked.get(token);
    if (until && until > Date.now()) return { error: 'KICKED_RECENTLY' };
    if (this.settings.isPrivate && this.settings.password && password !== this.settings.password) {
      return { error: 'WRONG_PASSWORD', needPassword: true };
    }
    if (this.players.size >= this.settings.maxPlayers) return { error: 'ROOM_FULL' };

    const prof = sanitizeProfile(profile);
    const player = {
      id: crypto.randomBytes(6).toString('hex'),
      token: token || crypto.randomBytes(12).toString('hex'),
      name: this.uniqueName(prof.name),
      avatar: prof.avatar,
      score: 0,
      connected: true,
      socket: null,
      guessed: false,
      lastDelta: 0,
      muted: false,
      voice: false,
      stats: { correct: 0, fastestMs: Infinity, drawPts: 0, reportsAgainst: 0 },
      chat: { times: [], recent: [], mutedNoticeAt: 0 },
      removeTimer: null,
    };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    this.bindSocket(player, socket);
    this.touch();
    this.system(`${player.name} đã vào phòng`, 'join');
    this.sendWelcome(player);
    this.checkLowPlayers();
    this.checkVotes();
    this.broadcastState();
    return { player };
  }

  uniqueName(name) {
    const names = new Set([...this.players.values()].map((p) => p.name.toLocaleLowerCase('vi')));
    if (!names.has(name.toLocaleLowerCase('vi'))) return name;
    for (let i = 2; ; i++) {
      const n = `${name.slice(0, 13)} ${i}`;
      if (!names.has(n.toLocaleLowerCase('vi'))) return n;
    }
  }

  reattach(player, socket, profile) {
    if (player.socket && player.socket !== socket) {
      const old = player.socket;
      old.data.room = null;
      old.emit('room:closed', { reason: 'Bạn vừa mở phòng này ở một tab khác.' });
      old.close(4000);
    }
    clearTimeout(player.removeTimer);
    player.removeTimer = null;
    const wasOffline = !player.connected;
    player.connected = true;
    if (profile?.avatar) player.avatar = sanitizeProfile(profile).avatar;
    this.bindSocket(player, socket);
    if (wasOffline) this.system(`${player.name} đã kết nối lại`, 'join');
    if (this.hostId === player.id && this.timers.hostGrace) { clearTimeout(this.timers.hostGrace); this.timers.hostGrace = null; }
    if (!this.players.get(this.hostId)?.connected && !this.timers.hostGrace) this.hostId = player.id;
    if (this.turn && this.turn.drawerId === player.id && this.timers.drawerGrace) {
      clearTimeout(this.timers.drawerGrace); this.timers.drawerGrace = null;
    }
    this.touch();
    this.sendWelcome(player);
    this.checkLowPlayers();
    this.broadcastState();
    return { player };
  }

  bindSocket(player, socket) {
    player.socket = socket;
    socket.data.room = this;
    socket.data.playerId = player.id;
    socket.join(this.channel);
  }

  sendWelcome(player) {
    const s = player.socket;
    s.emit('room:joined', { you: player.id, token: player.token, code: this.code });
    s.emit('room:state', this.stateFor(player));
    s.emit('canvas:sync', this.board.snapshot());
    if (this.phase === 'choosing' && this.turn?.drawerId === player.id) s.emit('turn:options', this.optionsPayload());
  }

  onDisconnect(player) {
    if (!player || !player.connected) return;
    player.connected = false;
    player.socket = null;
    player.voice = false;
    this.system(`${player.name} mất kết nối…`, 'leave');
    player.removeTimer = this.later(() => this.removePlayer(player.id, 'timeout'), this.ms('reconnectGrace'));
    if (this.hostId === player.id && !this.timers.hostGrace) {
      this.timers.hostGrace = this.later(() => {
        this.timers.hostGrace = null;
        if (!this.players.get(this.hostId)?.connected) this.passHost();
        this.broadcastState();
      }, this.ms('hostGrace'));
    }
    if (this.turn && this.turn.drawerId === player.id && (this.phase === 'choosing' || this.phase === 'drawing')) {
      clearTimeout(this.timers.drawerGrace);
      this.timers.drawerGrace = this.later(() => {
        this.timers.drawerGrace = null;
        const d = this.players.get(this.turn?.drawerId);
        if ((this.phase === 'choosing' || this.phase === 'drawing') && (!d || !d.connected)) this.endTurn('drawerLeft');
      }, this.ms('drawerGrace'));
    }
    this.checkLowPlayers();
    this.checkAllGuessed();
    this.checkVotes();
    this.broadcastState();
  }

  /** Rời phòng hẳn (tự rời, hết thời gian chờ, bị mời ra/cấm). */
  removePlayer(playerId, reason = 'leave') {
    const p = this.players.get(playerId);
    if (!p) return;
    clearTimeout(p.removeTimer);
    this.players.delete(playerId);
    if (p.socket) { p.socket.leave(this.channel); p.socket.data.room = null; p.socket.data.playerId = null; }
    const msg = {
      leave: `${p.name} đã rời phòng`, timeout: `${p.name} đã rời phòng (mất kết nối)`,
      kick: `${p.name} đã bị chủ phòng mời ra`, ban: `${p.name} đã bị chủ phòng cấm vào lại`,
      vote: `${p.name} đã bị cả phòng bỏ phiếu mời ra`,
    }[reason] || `${p.name} đã rời phòng`;
    this.system(msg, reason === 'leave' || reason === 'timeout' ? 'leave' : 'warn');
    this.votes.delete(playerId);
    for (const set of this.votes.values()) set.delete(playerId);
    this.queue = this.queue.filter((id) => id !== playerId);
    if (!this.players.size) { this.destroy(); return; }
    if (this.hostId === playerId) {
      clearTimeout(this.timers.hostGrace); this.timers.hostGrace = null;
      this.passHost();
    }
    if (this.inGame) {
      if (this.players.size < 2) { this.abort('Không đủ người chơi nên trận đấu dừng lại.'); return; }
      this.checkLowPlayers();
      if (this.turn && this.turn.drawerId === playerId && (this.phase === 'choosing' || this.phase === 'drawing')) {
        this.endTurn('drawerLeft');
        return;
      }
      this.checkAllGuessed();
    }
    this.checkVotes();
    this.broadcastState();
  }

  passHost() {
    const next = this.connectedPlayers.find((p) => p.id !== this.hostId) || this.connectedPlayers[0];
    if (!next) return;
    this.hostId = next.id;
    this.system(`${next.name} giờ là chủ phòng`, 'info');
  }

  /** Trong trận mà còn dưới 2 người kết nối: chờ một lúc rồi mới dừng (để người tải lại trang kịp quay về). */
  checkLowPlayers() {
    const low = this.inGame && this.connectedPlayers.length < 2;
    if (!low) { clearTimeout(this.timers.lowPlayers); this.timers.lowPlayers = null; return; }
    if (this.timers.lowPlayers) return;
    this.timers.lowPlayers = this.later(() => {
      this.timers.lowPlayers = null;
      if (this.inGame && this.connectedPlayers.length < 2) this.abort('Không đủ người chơi nên trận đấu dừng lại.');
    }, this.ms('lowPlayersGrace'));
  }

  // ════════════════ Quyền chủ phòng & quản lý ════════════════
  isHost(player) { return !!player && player.id === this.hostId; }

  /** Kiểm tra mục tiêu cho các lệnh quản lý; trả về [mã lỗi] hoặc [null, người bị tác động]. */
  target(actor, targetId, { hostOnly = true } = {}) {
    if (hostOnly && !this.isHost(actor)) return ['NOT_HOST'];
    if (targetId === actor.id) return ['SELF_ACTION'];
    const t = this.players.get(targetId);
    if (!t) return ['INVALID_PLAYER'];
    return [null, t];
  }

  kick(host, targetId) {
    const [err, t] = this.target(host, targetId);
    if (err) return err;
    this.kicked.set(t.token, Date.now() + this.ms('kickCooldown'));
    t.socket?.emit('kicked', { reason: 'Chủ phòng đã mời bạn ra khỏi phòng.', code: 'KICKED' });
    this.removePlayer(t.id, 'kick');
    return null;
  }

  ban(host, targetId) {
    const [err, t] = this.target(host, targetId);
    if (err) return err;
    this.banned.add(t.token);
    t.socket?.emit('kicked', { reason: 'Chủ phòng đã cấm bạn vào lại phòng này.', code: 'BANNED' });
    this.removePlayer(t.id, 'ban');
    return null;
  }

  setMute(host, targetId, muted) {
    const [err, t] = this.target(host, targetId);
    if (err) return err;
    if (t.muted === !!muted) return null;
    t.muted = !!muted;
    if (t.muted) t.voice = false;
    this.system(t.muted ? `Chủ phòng đã tắt chat của ${t.name}` : `Chủ phòng đã bật lại chat cho ${t.name}`, 'info');
    this.broadcastState();
    return null;
  }

  transferHost(host, targetId) {
    const [err, t] = this.target(host, targetId);
    if (err) return err;
    if (!t.connected) return 'INVALID_PLAYER';
    this.hostId = t.id;
    clearTimeout(this.timers.hostGrace); this.timers.hostGrace = null;
    this.system(`${t.name} giờ là chủ phòng`, 'info');
    this.broadcastState();
    return null;
  }

  /** Số phiếu cần để mời một người ra: quá nửa số người còn lại đang kết nối, tối thiểu 2. */
  votesNeeded(targetId) {
    const eligible = this.connectedPlayers.filter((p) => p.id !== targetId).length;
    if (eligible < 2) return null;
    return Math.max(2, Math.floor(eligible / 2) + 1);
  }

  voteKick(voter, targetId) {
    const [err, t] = this.target(voter, targetId, { hostOnly: false });
    if (err) return err;
    const need = this.votesNeeded(t.id);
    if (need === null) return 'VOTE_UNAVAILABLE';
    let set = this.votes.get(t.id);
    if (!set) { set = new Set(); this.votes.set(t.id, set); }
    if (set.has(voter.id)) return 'ALREADY_VOTED';
    set.add(voter.id);
    this.touch();
    this.system(`${voter.name} bỏ phiếu mời ${t.name} ra (${set.size}/${need})`, 'warn');
    if (!this.checkVotes()) this.broadcastState();
    return null;
  }

  /** Thực thi các cuộc bỏ phiếu đã đủ ngưỡng (ngưỡng thay đổi khi có người ra/vào). */
  checkVotes() {
    let acted = false;
    for (const [targetId, set] of [...this.votes]) {
      const t = this.players.get(targetId);
      if (!t) { this.votes.delete(targetId); continue; }
      for (const v of [...set]) if (!this.players.get(v)?.connected) set.delete(v);
      const need = this.votesNeeded(targetId);
      if (need !== null && set.size >= need) {
        this.votes.delete(targetId);
        this.banned.add(t.token);
        t.socket?.emit('kicked', { reason: 'Cả phòng đã bỏ phiếu mời bạn ra.', code: 'VOTE_KICKED' });
        this.removePlayer(t.id, 'vote');
        acted = true;
      }
    }
    return acted;
  }

  updateSettings(host, input) {
    if (!this.isHost(host)) return 'NOT_HOST';
    if (this.phase !== 'lobby') return 'INVALID_STATE';
    const { settings, rejectedWords } = sanitizeSettings(input, this.settings);
    // Không cho đặt số người tối đa thấp hơn số người đang ở trong phòng
    settings.maxPlayers = Math.max(settings.maxPlayers, this.players.size);
    this.settings = settings;
    this.touch();
    if (rejectedWords) host.socket?.emit('toast', { msg: `Đã bỏ qua ${rejectedWords} từ tự thêm không hợp lệ (chỉ dùng chữ, số, tối đa 32 ký tự).` });
    this.broadcastState();
    return null;
  }

  // ════════════════ Vòng đời trận đấu ════════════════
  startGame(host) {
    if (!this.isHost(host)) return 'NOT_HOST';
    if (this.phase !== 'lobby' && this.phase !== 'gameEnd') return 'INVALID_STATE';
    if (this.connectedPlayers.length < 2) return 'NOT_ENOUGH_PLAYERS';
    this.clearGameTimers();
    for (const p of this.players.values()) {
      p.score = 0; p.lastDelta = 0; p.guessed = false;
      p.stats = { correct: 0, fastestMs: Infinity, drawPts: 0, reportsAgainst: 0 };
    }
    this.used.clear();
    this.seen.clear();
    this.round = 0;
    this.queue = [];
    this.turn = null;
    this.board.reset();
    this.emitAll('canvas:sync', this.board.snapshot());
    this.touch();
    this.system('Trận đấu bắt đầu! Chúc cả hội vẽ xấu mà đoán giỏi.', 'info');
    this.emitAll('sfx', { name: 'start' });
    this.beginRound();
    return null;
  }

  /** Bắt đầu một hiệp mới: mọi người đang kết nối lần lượt vẽ một lần. */
  beginRound() {
    if (this.round >= this.settings.rounds) { this.endGame(); return; }
    this.round++;
    this.queue = this.connectedPlayers.map((p) => p.id);
    this.turn = null;
    this.setPhase('roundStart');
    this.system(`Hiệp ${this.round}/${this.settings.rounds}`, 'round');
    this.setPhaseTimer(() => this.nextTurn(), this.ms('roundIntro'));
    this.broadcastState();
  }

  /** Chuyển lượt cho người vẽ tiếp theo; hết người thì sang hiệp mới hoặc kết thúc trận. */
  nextTurn() {
    if (this.connectedPlayers.length < 2) { this.abort('Không đủ người chơi nên trận đấu dừng lại.'); return; }
    let drawer = null;
    while (this.queue.length && !drawer) {
      const p = this.players.get(this.queue.shift());
      if (p && p.connected) drawer = p;
    }
    if (!drawer) {
      if (this.round < this.settings.rounds) this.beginRound(); else this.endGame();
      return;
    }
    for (const p of this.players.values()) { p.guessed = false; p.lastDelta = 0; }
    const options = pickOptions({
      count: this.settings.wordCount, topics: this.settings.topics, used: this.used, seen: this.seen,
      custom: this.settings.customWords, customOnly: this.settings.customOnly, rand: this.rand,
    });
    for (const o of options) this.seen.add(o.w.normalize('NFC').toLocaleLowerCase('vi'));
    this.turn = {
      id: ++this.turnSeq, drawerId: drawer.id, options, word: null,
      startedAt: 0, endsAt: Date.now() + this.ms('choose'),
      revealed: new Set(), guessOrder: [], reports: new Set(), ratings: new Map(),
    };
    this.setPhase('choosing');
    this.board.reset();
    this.emitAll('canvas:sync', this.board.snapshot());
    drawer.socket?.emit('turn:options', this.optionsPayload());
    this.system(`${drawer.name} đang chọn từ…`, 'info');
    this.setPhaseTimer(() => this.autoChoose(), this.ms('choose'));
    this.broadcastState();
  }

  optionsPayload() {
    return {
      turnId: this.turn.id,
      endsAt: this.turn.endsAt,
      options: this.turn.options.map((o) => ({
        word: o.w, difficulty: o.d, label: DIFFICULTY[o.d].label,
        maxPoints: DIFFICULTY[o.d].guessMax, topic: TOPICS[o.t] || 'Từ tự thêm',
      })),
    };
  }

  /** Hết giờ chọn: tự chọn giúp nếu người vẽ còn kết nối, không thì bỏ lượt — game không bao giờ đứng. */
  autoChoose() {
    if (this.phase !== 'choosing') return;
    const drawer = this.players.get(this.turn.drawerId);
    if (!drawer || !drawer.connected) { this.endTurn('drawerLeft'); return; }
    this.applyWord(Math.floor(this.rand() * this.turn.options.length));
  }

  chooseWord(player, payload) {
    if (this.phase !== 'choosing' || !this.turn || player.id !== this.turn.drawerId) return 'INVALID_STATE';
    if (typeof payload === 'number') payload = { index: payload };
    const d = payload && typeof payload === 'object' ? payload : {};
    if (typeof d.customWord === 'string' && d.customWord.trim()) {
      const w = sanitizeText(d.customWord, 32);
      if (w.length < 1 || w.length > 32 || !/^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u.test(w) || !/\p{L}/u.test(w)) {
        return 'BAD_PAYLOAD';
      }
      this.applyWord({ w, a: [], d: 'medium', t: 'custom' });
      return null;
    }
    const index = d.index;
    if (!Number.isInteger(index) || index < 0 || index >= this.turn.options.length) return 'BAD_PAYLOAD';
    this.applyWord(index);
    return null;
  }

  applyWord(target) {
    const word = typeof target === 'number' ? this.turn.options[target] : target;
    if (!word || !word.w) return;
    const drawer = this.players.get(this.turn.drawerId);
    this.used.add(word.w.normalize('NFC').toLocaleLowerCase('vi'));
    this.turn.word = word;
    this.turn.startedAt = Date.now();
    this.turn.endsAt = this.turn.startedAt + this.drawMs();
    this.setPhase('drawing');
    this.touch();
    this.system(`${drawer ? drawer.name : 'Người vẽ'} đang vẽ…`, 'info');
    this.emitAll('sfx', { name: 'turn' });
    this.setPhaseTimer(() => this.endTurn('timeup'), this.drawMs());
    for (const at of hintPlan(word.w, this.settings.hints, this.drawMs(), this.settings.wordMode)) {
      this.timers.hints.push(this.later(() => this.revealHint(), at));
    }
    this.broadcastState();
  }

  revealHint() {
    if (this.phase !== 'drawing' || !this.turn?.word) return;
    const idx = letterIndexes(this.turn.word.w);
    const hidden = idx.filter((i) => !this.turn.revealed.has(i));
    if (hidden.length <= Math.ceil(idx.length / 2)) return; // không bao giờ mở quá nửa số chữ
    this.turn.revealed.add(hidden[Math.floor(this.rand() * hidden.length)]);
    this.emitAll('sfx', { name: 'hint' });
    this.broadcastState();
  }

  // ════════════════ Chat & đoán chữ ════════════════
  /** Chống spam: tối đa 6 tin / 4 giây và không gửi lặp một nội dung quá 2 lần / 15 giây. */
  allowChat(player, text) {
    const now = Date.now();
    const c = player.chat;
    c.times = c.times.filter((t) => now - t < 4000);
    if (c.times.length >= 6) { this.whisper(player, 'Gõ chậm lại chút nào!'); return false; }
    const key = clean(text);
    c.recent = c.recent.filter((r) => now - r.t < 15000);
    if (c.recent.filter((r) => r.k === key).length >= 2) { this.whisper(player, 'Đừng gửi lặp lại một tin nhé.'); return false; }
    c.times.push(now);
    c.recent.push({ k: key, t: now });
    return true;
  }

  whisper(player, text, extra = {}) {
    player.socket?.emit('chat:msg', { type: 'private', text, ts: Date.now(), ...extra });
  }

  /** Người bị tắt chat vẫn thấy tin của chính mình, nhưng server không gửi cho ai khác. */
  mutedNotice(player, text) {
    player.socket?.emit('chat:msg', { type: 'chat', from: player.id, name: player.name, text, ts: Date.now(), muted: true });
    const now = Date.now();
    if (now - player.chat.mutedNoticeAt > 5000) {
      player.chat.mutedNoticeAt = now;
      this.whisper(player, 'Chủ phòng đã tắt chat của bạn: bạn vẫn đoán được nhưng người khác không thấy tin nhắn.');
    }
  }

  chat(player, rawText) {
    const text = sanitizeText(rawText, 100);
    if (!text) return null;
    if (!this.allowChat(player, text)) return null;
    this.touch();
    const t = this.turn;
    const drawing = this.phase === 'drawing' && !!t?.word;
    const isDrawer = !!t && t.drawerId === player.id && (this.phase === 'choosing' || this.phase === 'drawing');
    const msg = { type: 'chat', from: player.id, name: player.name, text, ts: Date.now() };

    // Người vẽ & người đã đoán ra: chỉ những ai đã biết đáp án mới nhận (server chọn người nhận, không ẩn bằng CSS)
    if (drawing && (isDrawer || player.guessed)) {
      if (player.muted) { this.mutedNotice(player, text); return null; }
      this.toInsiders({ ...msg, type: 'insider' });
      return null;
    }
    if (this.phase === 'choosing' && isDrawer
      && t.options.some((o) => ['correct', 'contains'].includes(judgeGuess(text, [o.w, ...o.a], 'loose').result))) {
      this.whisper(player, 'Không được tiết lộ từ khoá đâu nhé.');
      return null;
    }
    if (!drawing) {
      if (player.muted) { this.mutedNotice(player, text); return null; }
      this.emitAll('chat:msg', msg);
      return null;
    }

    const word = t.word;
    const { result } = judgeGuess(text, [word.w, ...word.a], this.settings.accentMode);
    if (result === 'correct') { this.onCorrect(player); return null; }
    if (result === 'accent') {
      player.socket?.emit('chat:msg', {
        type: 'accent', guess: text, ts: Date.now(),
        text: this.settings.accentMode === 'strict' ? 'Đúng chữ nhưng sai dấu. Phòng này bắt buộc gõ đúng dấu.' : 'Gần đúng rồi, nhưng sai dấu!',
      });
      return null;
    }
    if (result === 'contains') { this.whisper(player, 'Tin nhắn có chứa đáp án nên đã bị ẩn. Hãy gõ riêng từ khoá thôi.'); return null; }
    if (player.muted) { this.mutedNotice(player, text); return null; }
    this.emitAll('chat:msg', msg);
    if (result === 'close') player.socket?.emit('chat:msg', { type: 'close', text: 'Bạn đoán rất gần rồi!', guess: text, ts: Date.now() });
    return null;
  }

  toInsiders(msg) {
    for (const p of this.players.values()) {
      if (p.connected && (p.guessed || p.id === this.turn?.drawerId)) p.socket?.emit('chat:msg', msg);
    }
  }

  onCorrect(player) {
    const now = Date.now();
    const order = this.turn.guessOrder.length;
    const pts = guesserPoints({
      difficulty: this.turn.word.d, timeLeftMs: Math.max(0, this.turn.endsAt - now), drawTimeMs: this.drawMs(), order,
    });
    player.guessed = true;
    player.score += pts;
    player.lastDelta = pts;
    player.stats.correct++;
    player.stats.fastestMs = Math.min(player.stats.fastestMs, now - this.turn.startedAt);
    this.turn.guessOrder.push(player.id);
    this.emitAll('chat:msg', { type: 'correct', from: player.id, text: `${player.name} đã đoán chính xác! (+${pts})`, ts: now });
    this.whisper(player, `Từ khoá là “${this.turn.word.w}”. Giờ bạn là khán giả: tin nhắn của bạn chỉ người đã đoán ra mới thấy.`);
    this.emitAll('sfx', { name: 'correct', who: player.id, pts });
    this.broadcastState();
    this.checkAllGuessed();
  }

  checkAllGuessed() {
    if (this.phase !== 'drawing' || !this.turn) return;
    const guessers = this.connectedPlayers.filter((p) => p.id !== this.turn.drawerId);
    if (guessers.length && guessers.every((p) => p.guessed)) this.endTurn('allGuessed');
  }

  report(player) {
    if (this.phase !== 'drawing' || !this.turn || player.id === this.turn.drawerId) return 'INVALID_STATE';
    if (this.turn.reports.has(player.id)) return 'ALREADY_VOTED';
    this.turn.reports.add(player.id);
    const guessers = this.connectedPlayers.filter((p) => p.id !== this.turn.drawerId).length;
    const need = Math.max(1, Math.ceil(guessers / 2));
    this.system(`${player.name} tố người vẽ đang viết chữ (${this.turn.reports.size}/${need})`, 'warn');
    if (this.turn.reports.size >= need) this.endTurn('reported');
    else this.broadcastState();
    return null;
  }

  /** Thích / không thích bức vẽ (như skribbl): mỗi người một lần mỗi lượt, người vẽ không tự chấm. Không ảnh hưởng điểm. */
  rate(player, like) {
    if (this.phase !== 'drawing' || !this.turn?.word || player.id === this.turn.drawerId) return 'INVALID_STATE';
    if (this.turn.ratings.has(player.id)) return 'ALREADY_RATED';
    this.turn.ratings.set(player.id, !!like);
    this.touch();
    const drawer = this.players.get(this.turn.drawerId);
    this.system(`${player.name} ${like ? 'thích' : 'chưa thích'} bức vẽ của ${drawer ? drawer.name : 'người vẽ'}`, like ? 'like' : 'dislike');
    this.broadcastState();
    return null;
  }

  endTurn(reason) {
    if (this.phase !== 'choosing' && this.phase !== 'drawing') return;
    this.clearGameTimers();
    const t = this.turn;
    const drawer = this.players.get(t.drawerId);
    if (t.word && drawer) {
      let dPts = 0;
      if (reason === 'reported') {
        dPts = -Math.min(REPORT_PENALTY, drawer.score);
        drawer.stats.reportsAgainst++;
      } else if (reason !== 'drawerLeft') {
        const guessers = [...this.players.values()].filter((p) => p.id !== t.drawerId && (p.connected || p.guessed)).length;
        dPts = drawerPoints({ difficulty: t.word.d, correct: t.guessOrder.length, guessers });
        drawer.stats.drawPts += dPts;
      }
      drawer.score += dPts;
      drawer.lastDelta = dPts;
    }
    this.board.commit();
    const reasonText = {
      timeup: 'Hết giờ!', allGuessed: 'Cả phòng đã đoán ra!', drawerLeft: 'Người vẽ đã rời đi.',
      reported: 'Người vẽ bị tố viết chữ nên mất lượt và bị trừ điểm.',
    }[reason] || '';
    this.setPhase('turnEnd');
    const word = t.word ? t.word.w : null;
    if (word) this.emitAll('chat:msg', { type: 'system', kind: 'reveal', text: `Đáp án: ${word}`, word, ts: Date.now() });
    else this.system(reasonText, 'warn');
    this.emitAll('turn:end', {
      turnId: t.id, word, reason, reasonText,
      deltas: [...this.players.values()]
        .map((p) => ({ id: p.id, name: p.name, delta: p.lastDelta, drawer: p.id === t.drawerId }))
        .sort((a, b) => b.delta - a.delta),
    });
    this.emitAll('sfx', { name: t.guessOrder.length ? 'turnEnd' : 'fail' });
    this.setPhaseTimer(() => this.nextTurn(), this.ms('turnEnd'));
    this.broadcastState();
  }

  endGame() {
    this.clearGameTimers();
    const ranking = [...this.players.values()].sort((a, b) => b.score - a.score || a.stats.fastestMs - b.stats.fastestMs);
    const titles = [];
    const best = (fn, asc = false) => ranking
      .filter((p) => Number.isFinite(fn(p)) && fn(p) > 0)
      .sort((a, b) => (asc ? fn(a) - fn(b) : fn(b) - fn(a)))[0];
    const fast = best((p) => p.stats.fastestMs, true);
    if (fast) titles.push({ id: fast.id, title: 'Tia chớp', desc: `Đoán nhanh nhất: ${(fast.stats.fastestMs / 1000).toFixed(1).replace('.', ',')} giây` });
    const artist = best((p) => p.stats.drawPts);
    if (artist) titles.push({ id: artist.id, title: 'Hoạ sĩ thiên tài', desc: `${artist.stats.drawPts} điểm từ tranh vẽ` });
    const psychic = best((p) => p.stats.correct);
    if (psychic) titles.push({ id: psychic.id, title: 'Nhà ngoại cảm', desc: `Đoán trúng ${psychic.stats.correct} lần` });
    const writer = best((p) => p.stats.reportsAgainst);
    if (writer) titles.push({ id: writer.id, title: 'Thư pháp gia bất đắc dĩ', desc: 'Bị tố viết chữ lên bảng' });

    this.setPhase('gameEnd');
    this.turn = null;
    this.queue = [];
    const top = ranking[0];
    const winners = top ? ranking.filter((p) => p.score === top.score) : [];
    if (winners.length) {
      this.system(winners.length > 1
        ? `Đồng hạng nhất: ${winners.map((p) => p.name).join(', ')} với ${top.score} điểm!`
        : `${top.name} vô địch với ${top.score} điểm!`, 'win');
    }
    this.setPhaseTimer(() => this.toLobby(), this.ms('gameEnd'));
    this.emitAll('game:end', {
      ranking: ranking.map((p, i) => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score, rank: i + 1 })),
      winners: winners.map((p) => p.id),
      titles,
      returnAt: this.phaseEndsAt,
    });
    this.emitAll('sfx', { name: 'win' });
    this.broadcastState();
  }

  /** Về phòng chờ (hết giờ màn tổng kết, chủ phòng bấm "Về phòng chờ", hoặc trận bị dừng). */
  toLobby() {
    this.clearGameTimers();
    this.setPhase('lobby');
    this.turn = null;
    this.queue = [];
    this.phaseEndsAt = 0;
    this.phaseMs = 0;
    for (const p of this.players.values()) { p.guessed = false; p.lastDelta = 0; }
    this.board.reset();
    this.emitAll('canvas:sync', this.board.snapshot());
    this.broadcastState();
  }

  returnToLobby(host) {
    if (!this.isHost(host)) return 'NOT_HOST';
    if (this.phase !== 'gameEnd') return 'INVALID_STATE';
    this.touch();
    this.toLobby();
    return null;
  }

  stopGame(host) {
    if (!this.isHost(host)) return 'NOT_HOST';
    if (!this.inGame) return 'INVALID_STATE';
    this.abort('Chủ phòng đã dừng trận đấu.');
    return null;
  }

  abort(text) {
    if (!this.inGame) return;
    this.system(text, 'warn');
    this.toLobby();
  }

  // ════════════════ Canvas ════════════════
  canDraw(player) { return !!player && this.phase === 'drawing' && this.turn?.drawerId === player.id; }

  drawStart(player, d) {
    if (!this.canDraw(player)) return;
    const color = COLOR_RE.test(d.c) ? d.c.toLowerCase() : '#111111';
    const size = clamp(Math.round(d.s), 1, 80);
    const stroke = this.board.start(color, size);
    if (!stroke) { this.boardFull(player); return; }
    this.touch();
    player.socket.to(this.channel).emit('draw:start', { id: stroke.id, c: color, s: size });
  }

  drawPoints(player, d) {
    if (!this.canDraw(player) || !this.board.live) return;
    const n = d.p.length - (d.p.length % 2);
    if (!n) return;
    const pts = new Array(n);
    for (let i = 0; i < n; i += 2) {
      pts[i] = clamp(Math.round(d.p[i]), -20, CW + 20);
      pts[i + 1] = clamp(Math.round(d.p[i + 1]), -20, CH + 20);
    }
    const stroke = this.board.add(pts);
    if (!stroke) { if (this.board.full) this.boardFull(player); return; }
    player.socket.to(this.channel).emit('draw:pts', { id: stroke.id, p: pts });
  }

  drawEnd(player) {
    if (!this.canDraw(player)) return;
    const id = this.board.end();
    if (id !== null) player.socket.to(this.channel).emit('draw:end', { id });
  }

  drawFill(player, d) {
    if (!this.canDraw(player)) return;
    const color = COLOR_RE.test(d.c) ? d.c.toLowerCase() : null;
    if (!color) return;
    const a = this.board.fill(clamp(Math.round(d.x), 0, CW - 1), clamp(Math.round(d.y), 0, CH - 1), color);
    if (!a) { this.boardFull(player); return; }
    this.touch();
    player.socket.to(this.channel).emit('draw:action', a);
  }

  drawClear(player) {
    if (!this.canDraw(player)) return;
    const a = this.board.clear();
    if (a) this.emitAll('draw:action', a);
  }

  drawUndo(player) {
    if (!this.canDraw(player)) return;
    if (this.board.undo()) this.emitAll('canvas:sync', this.board.snapshot());
  }

  drawRedo(player) {
    if (!this.canDraw(player)) return;
    if (this.board.redo()) this.emitAll('canvas:sync', this.board.snapshot());
  }

  resync(player) { player.socket?.emit('canvas:sync', this.board.snapshot()); }

  boardFull(player) {
    const now = Date.now();
    if (now - (player.boardFullAt || 0) > 5000) {
      player.boardFullAt = now;
      this.whisper(player, 'Bức vẽ đã quá nhiều nét. Hãy hoàn tác hoặc xoá bớt để vẽ tiếp.');
    }
  }

  // ════════════════ Voice chat (WebRTC: server chỉ chuyển tín hiệu, âm thanh đi thẳng giữa các máy) ════════════════
  voiceJoin(player) {
    if (player.muted) return 'VOICE_MUTED';
    if (player.voice) return null;
    player.voice = true;
    this.broadcastState();
    return null;
  }

  voiceLeave(player) {
    if (!player.voice) return null;
    player.voice = false;
    this.broadcastState();
    return null;
  }

  /** Chuyển offer/answer/ICE giữa hai người cùng đang bật voice trong phòng. */
  voiceSignal(player, d) {
    const t = this.players.get(d.to);
    if (!player.voice || !t || t === player || !t.voice || !t.socket) return null;
    t.socket.emit('voice:signal', { from: player.id, sdp: d.sdp || null, candidate: d.candidate || null });
    return null;
  }

  // ════════════════ Trạng thái gửi cho từng người ════════════════
  playerStatus(p) {
    if (!this.turn || !(this.phase === 'choosing' || this.phase === 'drawing' || this.phase === 'turnEnd')) return 'idle';
    if (p.id === this.turn.drawerId) return 'drawing';
    if (p.guessed) return 'guessed';
    return this.phase === 'drawing' ? 'guessing' : 'idle';
  }

  /** Trạng thái riêng cho một người xem: từ thật chỉ gửi cho người vẽ / người đã đoán ra / khi lượt đã kết thúc. */
  stateFor(viewer) {
    const t = this.turn;
    const isHost = !!viewer && viewer.id === this.hostId;
    const isDrawer = !!t && !!viewer && t.drawerId === viewer.id;
    const knows = !!t?.word && (isDrawer || !!viewer?.guessed || this.phase === 'turnEnd');
    const hidden = this.settings.wordMode === 'hidden';
    return {
      code: this.code,
      you: viewer ? viewer.id : null,
      now: Date.now(),
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      phaseMs: this.phaseMs,
      round: this.round,
      hostId: this.hostId,
      settings: {
        ...this.settings,
        password: undefined,
        hasPassword: !!this.settings.password,
        customWords: isHost ? this.settings.customWords : [],
        customWordCount: this.settings.customWords.length,
      },
      limits: LIMITS,
      topics: TOPICS,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, avatar: p.avatar, score: p.score, connected: p.connected,
        status: this.playerStatus(p), delta: p.lastDelta, muted: p.muted, voice: p.voice,
        votes: this.votes.get(p.id)?.size || 0,
        votedByYou: !!viewer && !!this.votes.get(p.id)?.has(viewer.id),
        votesNeeded: this.votesNeeded(p.id),
      })),
      turn: t ? {
        id: t.id,
        drawerId: t.drawerId,
        endsAt: t.endsAt,
        difficulty: t.word ? t.word.d : null,
        word: knows ? t.word.w : null,
        mask: t.word && !knows && !hidden ? makeMask(t.word.w, t.revealed) : null,
        length: t.word && !knows && !hidden ? lengthInfo(t.word.w) : null,
        hidden: !!t.word && !knows && hidden,
        reports: t.reports.size,
        reportedByYou: !!viewer && t.reports.has(viewer.id),
        likes: [...t.ratings.values()].filter(Boolean).length,
        dislikes: [...t.ratings.values()].filter((v) => !v).length,
        ratedByYou: viewer && t.ratings.has(viewer.id) ? (t.ratings.get(viewer.id) ? 'like' : 'dislike') : null,
      } : null,
    };
  }

  broadcastState() {
    if (this.closed) return;
    for (const p of this.players.values()) if (p.connected && p.socket) p.socket.emit('room:state', this.stateFor(p));
  }

  emitAll(event, data) { this.io.to(this.channel).emit(event, data); }
  system(text, kind = 'info') { this.emitAll('chat:msg', { type: 'system', kind, text, ts: Date.now() }); }

  summary() {
    return {
      code: this.code, name: this.settings.name, players: this.players.size, maxPlayers: this.settings.maxPlayers,
      phase: this.phase, round: this.round, rounds: this.settings.rounds,
      host: this.players.get(this.hostId)?.name || '', locked: !!this.settings.password,
    };
  }

  /** Đóng phòng: báo cho mọi người rồi giải phóng tài nguyên. */
  close(reason) {
    for (const p of this.players.values()) {
      clearTimeout(p.removeTimer);
      if (p.socket) {
        p.socket.emit('room:closed', { reason });
        p.socket.leave(this.channel);
        p.socket.data.room = null;
      }
    }
    this.players.clear();
    this.destroy();
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.clearGameTimers();
    clearTimeout(this.timers.hostGrace);
    for (const p of this.players.values()) clearTimeout(p.removeTimer);
    this.onEmpty?.(this);
  }
}

// ════════════════ Quản lý các phòng ════════════════
class Lobby {
  constructor(io, { timing, maxRooms = 1000, log } = {}) {
    this.io = io;
    this.timing = { ...DEFAULT_TIMING, ...(timing || {}) };
    this.maxRooms = maxRooms;
    this.log = log || (() => {});
    this.rooms = new Map();
    this.expired = new Map(); // mã phòng đã đóng → thời điểm đóng (để báo "hết hạn" thay vì "không tồn tại")
    this.sweeper = setInterval(() => this.sweep(), Math.max(1000, Math.round(60000 * this.timing.scale)));
    this.sweeper.unref();
  }

  newCode() {
    for (;;) {
      let code = '';
      const bytes = crypto.randomBytes(6);
      for (let i = 0; i < 6; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
      if (!this.rooms.has(code) && !this.expired.has(code)) return code;
    }
  }

  /** @returns {Room|null} null nếu máy chủ đã đạt số phòng tối đa */
  create(settings) {
    if (this.rooms.size >= this.maxRooms) return null;
    const code = this.newCode();
    const room = new Room({
      code, io: this.io, settings, timing: this.timing, log: this.log,
      onEmpty: (r) => { this.rooms.delete(r.code); this.expired.set(r.code, Date.now()); this.log('info', `Đóng phòng ${r.code}`); },
    });
    this.rooms.set(code, room);
    this.log('info', `Tạo phòng ${code}`);
    return room;
  }

  normalize(code) { return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }

  /** Tìm phòng theo mã: trả về { room } hoặc { error }. */
  lookup(code) {
    const c = this.normalize(code);
    const room = this.rooms.get(c);
    if (room) return { room };
    return { error: this.expired.has(c) ? 'ROOM_EXPIRED' : 'ROOM_NOT_FOUND' };
  }

  get(code) { return this.rooms.get(this.normalize(code)) || null; }

  /** Chơi nhanh: vào phòng công khai đông vui nhất còn chỗ, không có thì tạo phòng mới. */
  quickRoom() {
    const candidates = [...this.rooms.values()]
      .filter((r) => !r.settings.isPrivate && !r.closed && r.players.size < r.settings.maxPlayers && r.phase !== 'gameEnd')
      .sort((a, b) => (a.phase === 'lobby' ? 0 : 1) - (b.phase === 'lobby' ? 0 : 1) || b.connectedPlayers.length - a.connectedPlayers.length);
    return candidates[0] || this.create({ name: 'Phòng chơi nhanh' });
  }

  publicList() {
    return [...this.rooms.values()].filter((r) => !r.settings.isPrivate).map((r) => r.summary())
      .sort((a, b) => (a.phase === 'lobby' ? 0 : 1) - (b.phase === 'lobby' ? 0 : 1) || b.players - a.players)
      .slice(0, 50);
  }

  /** Dọn phòng chờ bỏ hoang, quên mã phòng đã đóng quá lâu, xoá lệnh cấm tạm đã hết hạn. */
  sweep() {
    const now = Date.now();
    const idle = Math.round(this.timing.roomIdle * this.timing.scale);
    for (const room of [...this.rooms.values()]) {
      if ((room.phase === 'lobby' || room.phase === 'gameEnd') && now - room.lastActivity > idle) {
        this.log('info', `Phòng ${room.code} hết hạn do không hoạt động`);
        room.close('Phòng đã đóng vì không hoạt động quá lâu.');
      }
    }
    for (const [code, at] of this.expired) if (now - at > 6 * 3600000) this.expired.delete(code);
    for (const room of this.rooms.values()) for (const [tok, until] of room.kicked) if (until < now) room.kicked.delete(tok);
  }

  stop() {
    clearInterval(this.sweeper);
    for (const room of [...this.rooms.values()]) room.close('Máy chủ đang khởi động lại.');
  }
}

module.exports = { Room, Lobby, sanitizeSettings, sanitizeProfile, hintPlan, DEFAULT_SETTINGS, DEFAULT_TIMING, TRANSITIONS, LIMITS, ERR };
