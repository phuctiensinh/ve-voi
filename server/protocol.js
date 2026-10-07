// Giao thức client ↔ server: tên sự kiện, schema kiểm tra payload, mã lỗi, giới hạn tần suất.
// Không dùng thư viện ngoài: mỗi schema là một hàm (value) => boolean.
'use strict';

/** Mã lỗi → câu thông báo tiếng Việt hiển thị cho người chơi (không bao giờ lộ stack trace). */
const ERR = {
  BAD_PAYLOAD: 'Yêu cầu không hợp lệ.',
  RATE_LIMITED: 'Bạn thao tác nhanh quá, chậm lại chút nhé.',
  ROOM_NOT_FOUND: 'Không tìm thấy phòng này. Kiểm tra lại mã 6 ký tự nhé.',
  ROOM_EXPIRED: 'Phòng này đã đóng hoặc hết hạn.',
  ROOM_FULL: 'Phòng đã đủ người.',
  WRONG_PASSWORD: 'Sai mật khẩu phòng.',
  BANNED: 'Bạn đã bị cấm vào phòng này.',
  KICKED_RECENTLY: 'Bạn vừa bị mời ra. Thử lại sau ít phút nhé.',
  NOT_HOST: 'Chỉ chủ phòng mới làm được việc này.',
  NOT_IN_ROOM: 'Bạn chưa ở trong phòng nào.',
  INVALID_PLAYER: 'Không tìm thấy người chơi này.',
  INVALID_STATE: 'Không thể làm việc này lúc này.',
  NOT_ENOUGH_PLAYERS: 'Cần ít nhất 2 người đang kết nối để bắt đầu.',
  VOTE_UNAVAILABLE: 'Cần ít nhất 3 người trong phòng mới bỏ phiếu được.',
  ALREADY_VOTED: 'Bạn đã bỏ phiếu cho người này rồi.',
  ALREADY_RATED: 'Bạn đã chấm bức vẽ này rồi.',
  SELF_ACTION: 'Không thể làm việc này với chính mình.',
  SERVER_BUSY: 'Máy chủ đang quá tải, thử lại sau nhé.',
  TOO_MANY_ROOMS: 'Bạn tạo phòng nhiều quá, đợi một lát nhé.',
};

// ───────── Bộ dựng schema tối giản ─────────
const S = {
  str: (max, min = 0) => (v) => typeof v === 'string' && v.length >= min && v.length <= max,
  int: (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max,
  num: (min, max) => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max,
  bool: () => (v) => typeof v === 'boolean',
  opt: (f) => (v) => v === undefined || v === null || f(v),
  arr: (f, max) => (v) => Array.isArray(v) && v.length <= max && v.every(f),
  obj: (shape) => (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(shape).every((k) => shape[k](v[k])),
  any: () => () => true,
};

const profile = S.obj({
  name: S.str(64),
  avatar: S.opt(S.obj({ face: S.opt(S.num(-1e6, 1e6)), color: S.opt(S.num(-1e6, 1e6)) })),
});
const settings = S.obj({
  name: S.opt(S.str(200)),
  maxPlayers: S.opt(S.num(-1e6, 1e6)), rounds: S.opt(S.num(-1e6, 1e6)), drawTime: S.opt(S.num(-1e6, 1e6)),
  wordCount: S.opt(S.num(-1e6, 1e6)), hints: S.opt(S.num(-1e6, 1e6)),
  wordMode: S.opt(S.str(20)), accentMode: S.opt(S.str(20)),
  isPrivate: S.opt(S.bool()), password: S.opt(S.str(100)),
  topics: S.opt(S.arr(S.str(40), 40)),
  customWords: S.opt((v) => (typeof v === 'string' ? v.length <= 8000 : Array.isArray(v) && v.length <= 500 && v.every(S.str(200)))),
  customOnly: S.opt(S.bool()),
});
const token = S.opt(S.str(64));
const target = S.obj({ playerId: S.str(32, 1) });
const color = S.str(7, 7);

/** Sự kiện client → server và schema payload tương ứng. */
const C2S = {
  'rooms:list': S.any(),
  'room:create': S.obj({ token, profile: S.opt(profile), settings: S.opt(settings) }),
  'room:join': S.obj({ code: S.str(16, 1), token, profile: S.opt(profile), password: S.opt(S.str(64)) }),
  'room:quick': S.obj({ token, profile: S.opt(profile) }),
  'room:leave': S.any(),
  'host:settings': S.obj({ settings }),
  'host:start': S.any(),
  'host:stop': S.any(),
  'host:lobby': S.any(),
  'host:kick': target,
  'host:ban': target,
  'host:transfer': target,
  'host:mute': S.obj({ playerId: S.str(32, 1), muted: S.bool() }),
  'vote:kick': target,
  'word:choose': S.obj({ index: S.int(0, 9) }),
  chat: S.obj({ text: S.str(1000) }),
  report: S.any(),
  'draw:rate': S.obj({ like: S.bool() }),
  'draw:start': S.obj({ c: color, s: S.num(1, 100) }),
  'draw:pts': S.obj({ id: S.opt(S.int(0, 1e9)), p: S.arr(S.num(-1e4, 1e4), 1200) }),
  'draw:end': S.any(),
  'draw:fill': S.obj({ x: S.num(-1e4, 1e4), y: S.num(-1e4, 1e4), c: color }),
  'draw:undo': S.any(),
  'draw:redo': S.any(),
  'draw:clear': S.any(),
  'canvas:resync': S.any(),
  'ping:time': S.obj({ t: S.num(0, 1e15) }),
};

/** Sự kiện server → client (để tra cứu; payload mô tả trong README). */
Object.freeze(C2S);

const S2C = [
  'room:joined', 'room:state', 'room:error', 'room:left', 'room:closed', 'rooms:list', 'kicked', 'error:action',
  'chat:msg', 'turn:options', 'turn:end', 'game:end', 'sfx',
  'canvas:sync', 'draw:start', 'draw:pts', 'draw:end', 'draw:action', 'pong:time', 'toast',
];

/** Giới hạn tần suất mỗi kết nối: [số sự kiện mỗi giây, sức chứa tối đa]. */
const RATE = {
  'draw:pts': [80, 160], 'draw:start': [25, 50], 'draw:end': [25, 50], 'draw:fill': [6, 12],
  'draw:undo': [10, 20], 'draw:redo': [10, 20], 'draw:clear': [3, 6], 'canvas:resync': [1, 3],
  chat: [3, 8], 'room:create': [0.2, 3], 'room:join': [1, 6], 'room:quick': [0.5, 4], 'rooms:list': [2, 6],
  'room:leave': [2, 5], 'host:settings': [10, 30], 'ping:time': [2, 6], 'word:choose': [2, 5],
  default: [5, 15],
};

/** Kiểm tra payload; trả về true nếu hợp lệ. Sự kiện lạ luôn bị từ chối. */
function validate(event, data) {
  // Object.hasOwn: chặn tên sự kiện trùng thuộc tính có sẵn của Object ("constructor", "valueOf"…)
  if (typeof event !== 'string' || !Object.hasOwn(C2S, event)) return false;
  try { return C2S[event](data) === true; } catch { return false; }
}

module.exports = { ERR, S, C2S, S2C, RATE, validate };
