'use strict';
// Lõi game chạy trực tiếp (không qua mạng): máy trạng thái, xoay vòng người vẽ, giữ bí mật từ khoá,
// kênh chat, chống spam, tố cáo, bỏ phiếu. Dùng IO giả nên hoàn toàn tất định.
const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Room, TRANSITIONS } = require('../server/game');

class FakeIO {
  constructor() { this.channels = new Map(); }
  to(ch, except) {
    return { emit: (e, d) => { for (const s of this.channels.get(ch) || []) if (s !== except) s.emit(e, d); } };
  }
}
class FakeSocket {
  constructor(io, name) { this.io = io; this.name = name; this.data = {}; this.log = []; this.closed = false; }
  emit(e, d) { this.log.push({ e, d: JSON.parse(JSON.stringify(d ?? null)) }); }
  join(ch) { if (!this.io.channels.has(ch)) this.io.channels.set(ch, new Set()); this.io.channels.get(ch).add(this); }
  leave(ch) { this.io.channels.get(ch)?.delete(this); }
  to(ch) { return this.io.to(ch, this); }
  close() { this.closed = true; }
  last(e) { for (let i = this.log.length - 1; i >= 0; i--) if (this.log[i].e === e) return this.log[i].d; return null; }
  all(e) { return this.log.filter((m) => m.e === e).map((m) => m.d); }
  text() { return this.log.map((m) => JSON.stringify(m)).join('\n'); }
}

// Dọn mọi phòng sau mỗi test (kể cả khi test lỗi giữa chừng) để không còn hẹn giờ chạy ngầm
const rooms = [];
afterEach(() => { while (rooms.length) rooms.pop().destroy(); });

/** Phòng với n người; thời lượng thật (scale 1) nên không hẹn giờ nào kịp chạy trong lúc test đồng bộ. */
function setup(n, settings = {}) {
  const io = new FakeIO();
  const room = new Room({ code: 'TEST01', io, settings: { rounds: 2, ...settings }, timing: { scale: 1 }, rand: () => 0.5 });
  rooms.push(room);
  const ps = [];
  for (let i = 0; i < n; i++) {
    const s = new FakeSocket(io, `P${i}`);
    const { player } = room.addPlayer(s, { token: `tok${i}`, profile: { name: `P${i}` } });
    ps.push({ s, p: player });
  }
  return { io, room, ps, by: (id) => ps.find((x) => x.p.id === id) };
}

/** Đi tới pha vẽ của lượt kế tiếp (gọi trực tiếp thay cho bộ hẹn giờ). */
function toDrawing(room, index = 0) {
  for (let i = 0; i < 3 && (room.phase === 'roundStart' || room.phase === 'turnEnd'); i++) room.nextTurn();
  assert.equal(room.phase, 'choosing');
  const drawerId = room.turn.drawerId;
  assert.equal(room.chooseWord(room.players.get(drawerId), index), null);
  assert.equal(room.phase, 'drawing');
  return drawerId;
}

test('máy trạng thái: chỉ cho phép chuyển pha hợp lệ', () => {
  const { room } = setup(2);
  assert.throws(() => room.setPhase('drawing'), /không hợp lệ/);
  assert.throws(() => room.setPhase('turnEnd'), /không hợp lệ/);
  assert.equal(room.startGame(room.players.get(room.hostId)), null);
  assert.equal(room.phase, 'roundStart');
  assert.throws(() => room.setPhase('drawing'));
  // mọi pha đều có đường quay về phòng chờ (dừng trận / lỗi)
  for (const [from, to] of Object.entries(TRANSITIONS)) if (from !== 'lobby') assert.ok(to.includes('lobby'), from);
  room.destroy();
});

test('xoay vòng: mỗi hiệp ai cũng vẽ đúng một lần, theo thứ tự vào phòng; hết hiệp thì kết thúc trận', () => {
  const { room, ps } = setup(3, { rounds: 2 });
  room.startGame(ps[0].p);
  const drawers = [];
  for (let turn = 0; turn < 6; turn++) {
    const d = toDrawing(room);
    drawers.push(d);
    for (const { p } of ps) if (p.id !== d) room.chat(p, room.turn.word.w);
    assert.equal(room.phase, 'turnEnd', 'cả phòng đoán ra → hết lượt ngay');
  }
  const ids = ps.map((x) => x.p.id);
  assert.deepEqual(drawers, [...ids, ...ids]);
  room.nextTurn();
  assert.equal(room.phase, 'gameEnd');
  const end = ps[0].s.last('game:end');
  assert.equal(end.ranking.length, 3);
  assert.ok(end.ranking[0].score >= end.ranking[1].score && end.ranking[1].score >= end.ranking[2].score);
  room.destroy();
});

test('xoay vòng: người vào giữa hiệp chờ hiệp sau; người mất kết nối bị bỏ qua', () => {
  const { io, room, ps } = setup(3, { rounds: 2 });
  room.startGame(ps[0].p);
  toDrawing(room); // P0 vẽ
  const late = new FakeSocket(io, 'late');
  const { player: L } = room.addPlayer(late, { token: 'late', profile: { name: 'Muộn' } });
  room.onDisconnect(ps[1].p); // P1 rớt mạng, còn trong thời gian chờ
  room.endTurn('timeup');
  room.nextTurn();
  assert.equal(room.turn.drawerId, ps[2].p.id, 'P1 mất kết nối → bỏ qua, tới P2');
  room.endTurn('timeup');
  room.nextTurn(); // hết hiệp 1 → hiệp 2
  assert.equal(room.phase, 'roundStart');
  assert.equal(room.round, 2);
  assert.ok(room.queue.includes(L.id), 'người vào muộn có tên ở hiệp sau');
  assert.ok(!room.queue.includes(ps[1].p.id), 'người đang mất kết nối không có trong lượt');
  room.destroy();
});

test('bí mật từ khoá: chỉ người vẽ / người đã đoán ra / lúc công bố mới có từ trong state', () => {
  const { room, ps, by } = setup(3);
  room.startGame(ps[0].p);
  room.nextTurn();
  const drawer = by(room.turn.drawerId);
  const [g1, g2] = ps.filter((x) => x !== drawer);
  const options = drawer.s.last('turn:options').options.map((o) => o.word);
  assert.equal(options.length, 3);
  for (const g of [g1, g2]) {
    assert.equal(g.s.all('turn:options').length, 0, 'người đoán không nhận danh sách từ');
    assert.equal(room.stateFor(g.p).turn.word, null);
  }
  room.chooseWord(drawer.p, 1);
  const word = room.turn.word.w;
  assert.equal(room.stateFor(drawer.p).turn.word, word);
  const st = room.stateFor(g1.p).turn;
  assert.equal(st.word, null);
  assert.ok(st.mask.every((c) => c === '_' || c === ' ' || c === '-'), 'mặt nạ chưa lộ chữ nào');
  room.chat(g1.p, word);
  assert.equal(room.stateFor(g1.p).turn.word, word, 'đoán ra rồi thì thấy từ');
  assert.equal(room.stateFor(g2.p).turn.word, null);
  // g2 chưa nhận được từ ở bất kỳ gói tin nào
  for (const w of options) assert.ok(!g2.s.text().toLocaleLowerCase('vi').includes(w.toLocaleLowerCase('vi')), `lộ "${w}" cho người chưa đoán`);
  room.endTurn('timeup');
  assert.equal(room.stateFor(g2.p).turn.word, word, 'hết lượt thì công bố cho tất cả');
  room.destroy();
});

test('chế độ ẩn từ: không gửi mặt nạ/độ dài, không gợi ý', () => {
  const { room, ps, by } = setup(2, { wordMode: 'hidden', hints: 3 });
  room.startGame(ps[0].p);
  toDrawing(room);
  const g = ps.find((x) => x.p.id !== room.turn.drawerId);
  const t = room.stateFor(g.p).turn;
  assert.equal(t.mask, null);
  assert.equal(t.length, null);
  assert.equal(t.hidden, true);
  assert.equal(room.timers.hints.length, 0);
  assert.ok(by(room.turn.drawerId));
  room.destroy();
});

test('gợi ý: mở dần chữ cái nhưng không quá một nửa', () => {
  const { room, ps } = setup(2, { hints: 5 });
  room.startGame(ps[0].p);
  toDrawing(room);
  const g = ps.find((x) => x.p.id !== room.turn.drawerId);
  for (let i = 0; i < 10; i++) room.revealHint();
  const mask = room.stateFor(g.p).turn.mask;
  const shown = mask.filter((c) => c !== '_' && c !== ' ' && c !== '-').length;
  const letters = mask.filter((c) => c !== ' ' && c !== '-').length;
  assert.ok(shown >= 1 && shown <= Math.floor(letters / 2), `${shown}/${letters}`);
  room.destroy();
});

test('chat: người vẽ & người đã đoán ra chỉ nói chuyện với nhau; đoán sai là chat thường', () => {
  const { room, ps, by } = setup(3);
  room.startGame(ps[0].p);
  toDrawing(room);
  const drawer = by(room.turn.drawerId);
  const [g1, g2] = ps.filter((x) => x !== drawer);
  const word = room.turn.word.w;
  room.chat(drawer.p, 'gợi ý nè: to lắm');
  assert.ok(!g1.s.text().includes('gợi ý nè'), 'người đoán không thấy tin của người vẽ');
  room.chat(g1.p, word);
  room.chat(g1.p, 'dễ quá trời');
  assert.ok(drawer.s.text().includes('dễ quá trời'), 'người vẽ thấy tin của người đã đoán ra');
  assert.ok(!g2.s.text().includes('dễ quá trời'), 'người chưa đoán không thấy');
  assert.ok(g2.s.text().includes('đã đoán chính xác'), 'mọi người đều được báo có người đoán đúng');
  room.chat(g2.p, 'đây là câu đoán sai');
  assert.ok(g1.s.text().includes('đây là câu đoán sai'), 'đoán sai là chat bình thường');
  room.destroy();
});

test('chat: người vẽ không được nói từ khoá lúc đang chọn', () => {
  const { room, ps, by } = setup(2);
  room.startGame(ps[0].p);
  room.nextTurn();
  const drawer = by(room.turn.drawerId);
  const other = ps.find((x) => x !== drawer);
  const w = drawer.s.last('turn:options').options[0].word;
  room.chat(drawer.p, `mình sẽ vẽ ${w}`);
  assert.ok(!other.s.text().includes(w));
  assert.ok(drawer.s.all('chat:msg').some((m) => m.type === 'private' && /tiết lộ/.test(m.text)));
  room.destroy();
});

test('chống spam: tối đa 6 tin / 4 giây, không lặp một nội dung quá 2 lần', () => {
  const { room, ps } = setup(2);
  const [a, b] = ps;
  for (let i = 0; i < 10; i++) room.chat(a.p, `tin số ${i}`);
  const got = b.s.all('chat:msg').filter((m) => m.type === 'chat').length;
  assert.equal(got, 6);
  assert.ok(a.s.all('chat:msg').some((m) => m.type === 'private' && /chậm lại/.test(m.text)));
  const { room: r2, ps: q } = setup(2);
  for (let i = 0; i < 4; i++) r2.chat(q[0].p, 'giống hệt');
  assert.equal(q[1].s.all('chat:msg').filter((m) => m.type === 'chat').length, 2);
  room.destroy(); r2.destroy();
});

test('tắt chat: người khác không thấy tin, nhưng đoán đúng vẫn được tính điểm', () => {
  const { room, ps, by } = setup(3);
  room.startGame(ps[0].p);
  toDrawing(room);
  const drawer = by(room.turn.drawerId);
  const [g1, g2] = ps.filter((x) => x !== drawer);
  const host = room.players.get(room.hostId);
  const target = g1.p.id === host.id ? g2 : g1;
  const watcher = target === g1 ? g2 : g1;
  assert.equal(room.setMute(host, target.p.id, true), null);
  room.chat(target.p, 'xin chào mọi người');
  assert.ok(!watcher.s.text().includes('xin chào mọi người'));
  assert.ok(target.s.all('chat:msg').some((m) => m.muted && m.text === 'xin chào mọi người'), 'người bị tắt chat vẫn thấy tin của mình');
  room.chat(target.p, room.turn.word.w);
  assert.ok(target.p.guessed && target.p.score > 0);
  assert.equal(room.setMute(target.p, host.id, true), 'NOT_HOST');
  room.destroy();
});

test('tố viết chữ: đủ một nửa người đoán thì người vẽ mất lượt và bị trừ điểm (không âm)', () => {
  const { room, ps, by } = setup(3);
  room.startGame(ps[0].p);
  toDrawing(room);
  const drawer = by(room.turn.drawerId);
  drawer.p.score = 60;
  const [g1] = ps.filter((x) => x !== drawer);
  assert.equal(room.report(drawer.p), 'INVALID_STATE', 'người vẽ không tự tố mình');
  assert.equal(room.report(g1.p), null);
  assert.equal(room.phase, 'turnEnd');
  assert.equal(drawer.p.score, 0);
  assert.equal(g1.s.last('turn:end').reason, 'reported');
  room.destroy();
});

test('thích / chưa thích bức vẽ: mỗi người một lần mỗi lượt, người vẽ không tự chấm, không đổi điểm', () => {
  const { room, ps, by } = setup(3);
  room.startGame(ps[0].p);
  room.nextTurn();
  const drawer = by(room.turn.drawerId);
  const [g1, g2] = ps.filter((x) => x !== drawer);
  assert.equal(room.rate(g1.p, true), 'INVALID_STATE', 'chưa vẽ thì chưa chấm');
  room.chooseWord(drawer.p, 0);
  assert.equal(room.rate(drawer.p, true), 'INVALID_STATE');
  assert.equal(room.rate(g1.p, true), null);
  assert.equal(room.rate(g1.p, false), 'ALREADY_RATED');
  assert.equal(room.rate(g2.p, false), null);
  const t = room.stateFor(g1.p).turn;
  assert.deepEqual({ likes: t.likes, dislikes: t.dislikes, mine: t.ratedByYou }, { likes: 1, dislikes: 1, mine: 'like' });
  assert.equal(room.stateFor(drawer.p).turn.ratedByYou, null);
  assert.ok(ps.every((x) => x.p.score === 0));
  assert.ok(g2.s.all('chat:msg').some((m) => m.kind === 'like' && m.text.includes(g1.p.name)));
});

test('bỏ phiếu mời ra: cần quá nửa số người còn lại; người bị mời ra không vào lại được', () => {
  const { io, room, ps } = setup(4);
  const [a, b, c, d] = ps;
  assert.equal(room.voteKick(a.p, a.p.id), 'SELF_ACTION');
  assert.equal(room.voteKick(a.p, d.p.id), null);
  assert.equal(room.voteKick(a.p, d.p.id), 'ALREADY_VOTED');
  assert.ok(room.players.has(d.p.id), '1/2 phiếu chưa đủ');
  assert.equal(room.stateFor(b.p).players.find((p) => p.id === d.p.id).votes, 1);
  assert.equal(room.voteKick(b.p, d.p.id), null);
  assert.ok(!room.players.has(d.p.id));
  assert.equal(d.s.last('kicked').code, 'VOTE_KICKED');
  assert.equal(room.addPlayer(new FakeSocket(io), { token: 'tok3', profile: { name: 'D' } }).error, 'BANNED');
  // còn 3 người → mời 1 người cần 2 phiếu; 2 người thì không bỏ phiếu được
  room.removePlayer(c.p.id, 'leave');
  assert.equal(room.voteKick(a.p, b.p.id), 'VOTE_UNAVAILABLE');
  room.destroy();
});

test('người vẽ rời đi giữa lượt: lượt kết thúc ngay, người vẽ không được điểm', () => {
  const { room, ps, by } = setup(3);
  room.startGame(ps[0].p);
  toDrawing(room);
  const drawer = by(room.turn.drawerId);
  const others = ps.filter((x) => x !== drawer);
  room.chat(others[0].p, room.turn.word.w);
  room.removePlayer(drawer.p.id, 'leave');
  assert.equal(room.phase, 'turnEnd');
  assert.equal(others[1].s.last('turn:end').reason, 'drawerLeft');
  assert.ok(others[0].p.score > 0, 'người đã đoán đúng vẫn giữ điểm');
  room.destroy();
});

test('dưới 2 người thì trận dừng, về phòng chờ', () => {
  const { room, ps } = setup(2);
  room.startGame(ps[0].p);
  toDrawing(room);
  room.removePlayer(ps[1].p.id, 'leave');
  assert.equal(room.phase, 'lobby');
  assert.equal(room.hostId, ps[0].p.id);
  room.destroy();
});

test('quyền chủ phòng: chỉ chủ phòng đổi cài đặt / bắt đầu / dừng / mời ra; không đổi cài đặt giữa trận', () => {
  const { room, ps } = setup(3);
  const [host, b, c] = ps;
  assert.equal(room.updateSettings(b.p, { rounds: 5 }), 'NOT_HOST');
  assert.equal(room.startGame(b.p), 'NOT_HOST');
  assert.equal(room.kick(b.p, c.p.id), 'NOT_HOST');
  assert.equal(room.updateSettings(host.p, { rounds: 5, maxPlayers: 2 }), null);
  assert.equal(room.settings.rounds, 5);
  assert.equal(room.settings.maxPlayers, 3, 'không thấp hơn số người đang có');
  room.startGame(host.p);
  assert.equal(room.updateSettings(host.p, { rounds: 1 }), 'INVALID_STATE');
  assert.equal(room.stopGame(b.p), 'NOT_HOST');
  assert.equal(room.stopGame(host.p), null);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.transferHost(host.p, b.p.id), null);
  assert.equal(room.hostId, b.p.id);
  room.destroy();
});

test('từ tự thêm chỉ chủ phòng thấy nội dung, người khác chỉ thấy số lượng', () => {
  const { room, ps } = setup(2);
  room.updateSettings(ps[0].p, { customWords: 'Cầu Rồng, Chợ Bến Thành, Hồ Gươm' });
  assert.deepEqual(room.stateFor(ps[0].p).settings.customWords, ['Cầu Rồng', 'Chợ Bến Thành', 'Hồ Gươm']);
  const other = room.stateFor(ps[1].p).settings;
  assert.deepEqual(other.customWords, []);
  assert.equal(other.customWordCount, 3);
  assert.equal(other.password, undefined);
  room.destroy();
});
