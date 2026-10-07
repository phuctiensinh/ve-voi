'use strict';
// Luật chơi: điểm, ngân hàng từ, gợi ý, cài đặt phòng, giao thức, giới hạn tần suất, bảng vẽ.
const test = require('node:test');
const assert = require('node:assert/strict');
const { guesserPoints, drawerPoints, DIFFICULTY } = require('../server/scoring');
const { WORDS, TOPICS, DEFAULT_TOPICS, BANK, PATTERNS, pickOptions } = require('../server/words');
const { sanitizeSettings, sanitizeProfile, hintPlan, DEFAULT_SETTINGS, LIMITS } = require('../server/game');
const { validate, C2S, RATE, ERR } = require('../server/protocol');
const { Bucket, Limiter } = require('../server/ratelimit');
const { Board } = require('../server/board');
const { looseKey, letterIndexes } = require('../server/vietnamese');

// ───────── Điểm ─────────
test('điểm người đoán: nhanh hơn thì cao hơn, có trần theo độ khó, có sàn', () => {
  const fast = guesserPoints({ difficulty: 'hard', timeLeftMs: 79000, drawTimeMs: 80000, order: 0 });
  const slow = guesserPoints({ difficulty: 'hard', timeLeftMs: 5000, drawTimeMs: 80000, order: 3 });
  assert.equal(fast, 500);
  assert.ok(slow < fast && slow >= 100);
  for (const d of Object.keys(DIFFICULTY)) {
    assert.ok(guesserPoints({ difficulty: d, timeLeftMs: 80000, drawTimeMs: 80000, order: 0 }) <= DIFFICULTY[d].guessMax);
    assert.ok(guesserPoints({ difficulty: d, timeLeftMs: 0, drawTimeMs: 80000, order: 5 }) >= DIFFICULTY[d].guessMax * 0.2);
  }
});

test('điểm người đoán: người đầu tiên được thưởng thêm', () => {
  const a = guesserPoints({ difficulty: 'medium', timeLeftMs: 40000, drawTimeMs: 80000, order: 0 });
  const b = guesserPoints({ difficulty: 'medium', timeLeftMs: 40000, drawTimeMs: 80000, order: 1 });
  const c = guesserPoints({ difficulty: 'medium', timeLeftMs: 40000, drawTimeMs: 80000, order: 2 });
  assert.ok(a > b && b > c);
});

test('điểm người vẽ tỉ lệ với số người đoán trúng', () => {
  assert.equal(drawerPoints({ difficulty: 'medium', correct: 0, guessers: 4 }), 0);
  assert.equal(drawerPoints({ difficulty: 'medium', correct: 2, guessers: 4 }), 150);
  assert.equal(drawerPoints({ difficulty: 'medium', correct: 4, guessers: 4 }), 300);
  assert.equal(drawerPoints({ difficulty: 'hard', correct: 1, guessers: 0 }), 0);
});

// ───────── Ngân hàng từ ─────────
test('ngân hàng từ: ≥ 12 chủ đề, đủ 3 độ khó, không trùng, từ hợp lệ', () => {
  assert.ok(Object.keys(BANK).length >= 12);
  assert.ok(WORDS.length >= 400, `chỉ có ${WORDS.length} từ`);
  const keys = WORDS.map((w) => looseKey(w.w) + '|' + w.w.toLocaleLowerCase('vi'));
  assert.equal(new Set(WORDS.map((w) => w.w.normalize('NFC').toLocaleLowerCase('vi'))).size, WORDS.length, 'có từ bị trùng');
  assert.equal(keys.length, WORDS.length);
  for (const [k, cat] of Object.entries(BANK)) {
    assert.ok(TOPICS[k], k);
    const total = ['easy', 'medium', 'hard'].reduce((n, d) => n + (cat[d] || []).length, 0);
    assert.ok(total >= 15, `chủ đề ${k} quá ít từ`);
    // chủ đề bật sẵn phải có đủ 3 độ khó (thành ngữ tắt sẵn, chỉ có từ khó)
    if (DEFAULT_TOPICS.includes(k)) for (const d of ['easy', 'medium', 'hard']) assert.ok(cat[d].length > 0, `${k} thiếu độ khó ${d}`);
  }
  for (const w of WORDS) {
    assert.equal(w.w, w.w.normalize('NFC'), `${w.w} chưa chuẩn NFC`);
    assert.match(w.w, /^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u, w.w);
    assert.ok(letterIndexes(w.w).length >= 2, `${w.w} quá ngắn`);
  }
  assert.ok(!DEFAULT_TOPICS.includes('thanh-ngu'), 'thành ngữ tắt mặc định');
});

test('chọn từ: đúng số lượng & độ khó, không trùng nhau, tránh từ đã dùng', () => {
  for (const n of [1, 2, 3, 4, 5]) {
    const opts = pickOptions({ count: n, topics: DEFAULT_TOPICS, used: new Set() });
    assert.equal(opts.length, n);
    assert.deepEqual(opts.map((o) => o.d), PATTERNS[n]);
    assert.equal(new Set(opts.map((o) => o.w)).size, n);
  }
  const used = new Set();
  for (let i = 0; i < 60; i++) {
    const opts = pickOptions({ count: 3, topics: ['dong-vat'], used });
    for (const o of opts) assert.ok(!used.has(o.w.toLocaleLowerCase('vi')), `${o.w} bị lặp`);
    used.add(opts[0].w.toLocaleLowerCase('vi'));
  }
});

test('chọn từ: từ đã đưa ra cho người vẽ trước không quay lại khi ngân hàng còn đủ', () => {
  const used = new Set(), seen = new Set();
  for (let t = 0; t < 40; t++) {
    const opts = pickOptions({ count: 3, topics: DEFAULT_TOPICS, used, seen });
    for (const o of opts) {
      const k = o.w.toLocaleLowerCase('vi');
      assert.ok(!seen.has(k), `"${o.w}" đã từng được đưa ra`);
      seen.add(k);
    }
    used.add(opts[0].w.toLocaleLowerCase('vi'));
  }
});

test('chọn từ: chỉ lấy chủ đề đã bật; chỉ dùng từ tự thêm khi bật "chỉ từ tự thêm"', () => {
  for (let i = 0; i < 20; i++) {
    for (const o of pickOptions({ count: 3, topics: ['do-an'], used: new Set() })) assert.equal(o.t, 'do-an');
  }
  const custom = ['Khủng long bạo chúa', 'Tàu vũ trụ', 'Bánh xèo'];
  for (let i = 0; i < 10; i++) {
    const opts = pickOptions({ count: 3, topics: DEFAULT_TOPICS, used: new Set(), custom, customOnly: true });
    assert.equal(opts.length, 3);
    for (const o of opts) assert.ok(custom.includes(o.w));
  }
  // hết từ tự thêm chưa dùng thì vẫn chọn được (dùng lại) thay vì kẹt
  const used = new Set(custom.map((w) => w.toLocaleLowerCase('vi')));
  assert.equal(pickOptions({ count: 3, used, custom, customOnly: true }).length, 3);
});

// ───────── Gợi ý ─────────
test('gợi ý: không bao giờ mở quá nửa số chữ, tắt ở chế độ ẩn từ', () => {
  assert.deepEqual(hintPlan('Bánh mì', 0, 80000), []);
  assert.deepEqual(hintPlan('Bánh mì', 3, 80000, 'hidden'), []);
  assert.equal(hintPlan('Bánh mì', 5, 80000).length, 3, '6 chữ cái → tối đa 3 gợi ý');
  assert.equal(hintPlan('Bò', 2, 80000).length, 1);
  const plan = hintPlan('Máy bay trực thăng', 3, 80000);
  assert.equal(plan.length, 3);
  for (let i = 1; i < plan.length; i++) assert.ok(plan[i] > plan[i - 1]);
  assert.ok(plan.every((t) => t > 0 && t < 80000));
});

// ───────── Cài đặt phòng ─────────
test('cài đặt: kẹp giá trị vào giới hạn, bỏ giá trị rác, không tin client', () => {
  const { settings: s } = sanitizeSettings({
    maxPlayers: 99, rounds: -3, drawTime: 77, wordCount: 'abc', hints: 2.6,
    wordMode: 'weird', accentMode: 'strict', topics: ['dong-vat', 'khong-co', 5], name: '  <b>Phòng\u0000 vui</b>  ',
    isPrivate: false, password: 'secret', language: 'en',
  });
  assert.equal(s.maxPlayers, LIMITS.maxPlayers[1]);
  assert.equal(s.rounds, LIMITS.rounds[0]);
  assert.equal(s.drawTime, 80, 'làm tròn 10 giây');
  assert.equal(s.wordCount, DEFAULT_SETTINGS.wordCount);
  assert.equal(s.hints, 3);
  assert.equal(s.wordMode, 'normal');
  assert.equal(s.accentMode, 'strict');
  assert.deepEqual(s.topics, ['dong-vat']);
  assert.equal(s.name, '<b>Phòng vui</b>', 'bỏ ký tự điều khiển (hiển thị an toàn do client escape)');
  assert.equal(s.password, '', 'phòng công khai không có mật khẩu');
  assert.equal(s.language, 'vi');
  assert.equal(sanitizeSettings({ drawTime: 5 }).settings.drawTime, 30);
  assert.equal(sanitizeSettings({ drawTime: 500 }).settings.drawTime, 120);
  assert.deepEqual(sanitizeSettings({ topics: [] }).settings.topics, DEFAULT_TOPICS);
});

test('cài đặt: từ tự thêm được lọc, bỏ trùng (kể cả khác dấu kiểu cũ/mới), đếm từ bị loại', () => {
  const { settings: s, rejectedWords } = sanitizeSettings({
    customWords: 'Hoà bình, hòa bình, Bánh xèo,\n<script>,  , Cầu Rồng, ' + 'x'.repeat(40) + ', 1234, Sơn Tùng',
    customOnly: true,
  });
  assert.deepEqual(s.customWords, ['Hoà bình', 'Bánh xèo', 'Cầu Rồng', 'Sơn Tùng']);
  assert.equal(rejectedWords, 3, '<script>, chuỗi quá dài, chỉ có số');
  assert.equal(s.customOnly, true);
  assert.equal(sanitizeSettings({ customWords: ['Một', 'Hai'], customOnly: true }).settings.customOnly, false, 'dưới 3 từ thì không bật chỉ-từ-tự-thêm');
  const many = Array.from({ length: 260 }, (_, i) => `Từ số ${i}`);
  assert.equal(sanitizeSettings({ customWords: many }).settings.customWords.length, 200);
});

test('hồ sơ người chơi: tên được làm sạch và cắt ngắn, avatar trong giới hạn', () => {
  assert.deepEqual(sanitizeProfile({ name: '  Nhung\u200b  ', avatar: { face: 99, color: -5 } }), { name: 'Nhung', avatar: { face: 15, color: 0 } });
  assert.equal(sanitizeProfile({}).name, 'Hoạ sĩ ẩn danh');
  assert.equal(sanitizeProfile({ name: 'a'.repeat(50) }).name.length, 16);
});

// ───────── Giao thức ─────────
test('giao thức: payload sai kiểu / thiếu / sự kiện lạ đều bị từ chối', () => {
  assert.ok(validate('chat', { text: 'xin chào' }));
  assert.ok(!validate('chat', { text: 123 }));
  assert.ok(!validate('chat', null));
  assert.ok(!validate('chat', { text: 'a'.repeat(1001) }));
  assert.ok(!validate('hack:server', {}));
  assert.ok(!validate('__proto__', {}));
  assert.ok(!validate('constructor', {}));
  assert.ok(validate('draw:start', { c: '#ff0000', s: 8 }));
  assert.ok(!validate('draw:start', { c: 'red', s: 8 }));
  assert.ok(!validate('draw:pts', { p: new Array(1202).fill(1) }));
  assert.ok(!validate('draw:pts', { p: [1, 'a'] }));
  assert.ok(!validate('draw:pts', { p: [1, NaN] }));
  assert.ok(!validate('word:choose', { index: 1.5 }));
  assert.ok(validate('word:choose', { customWord: 'Mèo con' }));
  assert.ok(validate('word:choose', { index: 0 }));
  assert.ok(!validate('host:kick', { playerId: '' }));
  assert.ok(!validate('room:join', { code: 'ABCDEF', profile: { name: 5 } }));
  assert.ok(validate('room:join', { code: 'ABCDEF', token: 't', profile: { name: 'A', avatar: { face: 1, color: 2 } } }));
  for (const ev of Object.keys(C2S)) assert.ok(RATE[ev] || RATE.default, ev);
  for (const msg of Object.values(ERR)) assert.ok(!/stack|Error:|at \w+ \(/.test(msg), 'thông báo lỗi không lộ chi tiết kỹ thuật');
});

// ───────── Giới hạn tần suất ─────────
test('xô token: cho phép nổ ngắn rồi giới hạn, nạp lại theo thời gian', () => {
  const b = new Bucket(2, 3, 0);
  assert.ok(b.take(1, 0) && b.take(1, 0) && b.take(1, 0));
  assert.ok(!b.take(1, 0));
  assert.ok(b.take(1, 500), 'sau 0,5 giây nạp được 1 token');
  assert.ok(!b.take(1, 500));
  const lim = new Limiter({ chat: [1, 2], default: [5, 5] }, { maxKeys: 3 });
  assert.ok(lim.take('chat') && lim.take('chat'));
  assert.ok(!lim.take('chat'));
  for (let i = 0; i < 10; i++) lim.take(`k${i}`, 'default');
  assert.ok(lim.buckets.size <= 4, 'không phình bộ nhớ theo số khoá');
});

// ───────── Bảng vẽ ─────────
test('bảng vẽ: nét, đổ màu, hoàn tác, làm lại, xoá, ảnh chụp có nét dở', () => {
  const b = new Board();
  const s1 = b.start('#000000', 8);
  b.add([1, 1, 2, 2]);
  assert.deepEqual(b.snapshot().live, { id: s1.id, c: '#000000', s: 8, p: [1, 1, 2, 2] }, 'nét đang vẽ dở có trong ảnh chụp');
  assert.equal(b.end(), s1.id);
  assert.equal(b.snapshot().live, null);
  b.fill(10, 10, '#ff0000');
  assert.equal(b.actions.length, 2);
  assert.ok(b.undo());
  assert.equal(b.actions.length, 1);
  assert.ok(b.redo());
  assert.equal(b.actions.at(-1).type, 'fill');
  assert.ok(b.clear());
  assert.equal(b.clear(), null, 'xoá hai lần liên tiếp không tạo thao tác thừa');
  assert.ok(b.undo(), 'hoàn tác được cả lệnh xoá');
  assert.equal(b.actions.length, 2);
  // nét không có điểm nào thì không lưu
  b.start('#000000', 4); b.end();
  assert.equal(b.actions.length, 2);
  // vẽ nét mới thì mất khả năng làm lại
  b.undo(); b.start('#123456', 4); b.add([5, 5]); b.end();
  assert.ok(!b.redo());
});

test('bảng vẽ: có giới hạn điểm & thao tác để không tràn bộ nhớ', () => {
  const b = new Board({ maxPoints: 10, maxActions: 3 });
  b.start('#000000', 4);
  assert.ok(b.add(new Array(16).fill(1)));
  assert.equal(b.add(new Array(6).fill(1)), null, 'vượt quá số điểm cho phép');
  assert.ok(b.full);
  b.end();
  b.fill(1, 1, '#ffffff'); b.fill(2, 2, '#ffffff');
  assert.equal(b.fill(3, 3, '#ffffff'), null, 'vượt quá số thao tác');
  b.undo();
  assert.ok(!b.full, 'hoàn tác giải phóng chỗ');
});
