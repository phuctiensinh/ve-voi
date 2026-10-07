// Màn chơi: thanh trên (đồng hồ, hiệp, từ/gợi ý), bảng vẽ, công cụ vẽ, các lớp phủ theo pha của server.
import { $, $$, esc, avatarSVG, confirmBox } from './ui.js';
import { CanvasEngine, W as CW } from './canvas.js';
import { net, sound, S } from './state.js';

// 25 màu + ô chọn màu tuỳ ý = 2 hàng × 13
const PALETTE = [
  '#ffffff', '#bfc6d4', '#ff4d4d', '#ff9a2e', '#ffd43b', '#51cf66', '#22b8cf', '#339af0', '#5c7cfa', '#9775fa', '#f06595', '#c08457', '#ffd8b1',
  '#1d1d1d', '#5c6475', '#c92a2a', '#d9480f', '#f59f00', '#2b8a3e', '#0b7285', '#1864ab', '#364fc7', '#6741d9', '#a61e4d', '#7a4a24',
];
const SIZES = [{ s: 4, d: 6 }, { s: 8, d: 9 }, { s: 14, d: 13 }, { s: 22, d: 18 }, { s: 34, d: 24 }];
const DIFF = { easy: 'Dễ', medium: 'Trung bình', hard: 'Khó' };
const END_TITLE = {
  timeup: 'Hết giờ!', allGuessed: 'Cả phòng đoán ra rồi!', drawerLeft: 'Người vẽ đã rời đi', reported: 'Người vẽ bị tố viết chữ',
};

let engine;
let overlayKey = '';
let wordHTML = '';
let lastTick = -1;
let rushTurn = null;
let lastResync = 0;
let flashTimer = null;

// ───────── Phản hồi nhanh trên bảng vẽ ─────────
export function flash(text, color = '') {
  const el = $('#flash');
  el.textContent = text;
  el.className = `flash ${color}`;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.add('hidden'), 1900);
}

function requestResync() {
  if (Date.now() - lastResync < 1500) return;
  lastResync = Date.now();
  net.emit('canvas:resync');
}

// ───────── Công cụ vẽ ─────────
function setTool(t) {
  engine.tool = t;
  $$('.tools [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  updateCursor();
}
function setColor(c) {
  engine.color = c;
  if (engine.tool === 'eraser') setTool('brush');
  $$('#palette [data-c]').forEach((b) => b.classList.toggle('active', b.dataset.c === c));
  updateCursor();
}
function setSize(i) {
  engine.size = SIZES[i].s;
  $$('#sizes .size').forEach((b, j) => { b.classList.toggle('active', j === i); b.setAttribute('aria-checked', String(j === i)); });
  updateCursor();
}
/** Con trỏ là vòng tròn đúng cỡ nét trên màn hình. */
function updateCursor() {
  const cv = $('#canvas');
  if (!engine.enabled) { cv.style.cursor = ''; return; }
  if (engine.tool === 'fill') { cv.style.cursor = 'crosshair'; return; }
  const scale = (cv.clientWidth || CW) / CW;
  const size = engine.tool === 'eraser' ? Math.max(engine.size * 2, 14) : engine.size;
  const d = Math.max(6, Math.min(120, Math.round(size * scale)));
  const h = d / 2 + 2, box = d + 4;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${box}' height='${box}'><circle cx='${h}' cy='${h}' r='${d / 2}' fill='none' stroke='white' stroke-width='3'/><circle cx='${h}' cy='${h}' r='${d / 2}' fill='none' stroke='black' stroke-width='1.3'/></svg>`;
  cv.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(h)} ${Math.round(h)}, crosshair`;
}

function initToolbar() {
  $('#palette').innerHTML = PALETTE.map((c) => `<button type="button" role="radio" style="background:${c}" data-c="${c}" aria-label="Màu ${c}"></button>`).join('')
    + '<button type="button" class="custom" title="Chọn màu bất kỳ"><input type="color" id="color-custom" value="#ff8fc4" aria-label="Chọn màu bất kỳ"></button>';
  $('#sizes').innerHTML = SIZES.map((x, i) => `<button type="button" class="size" role="radio" data-i="${i}" title="Cỡ ${i + 1} (phím ${i + 1})" aria-label="Cỡ nét ${i + 1}" style="--d:${x.d}px"><i></i></button>`).join('');
  $('#palette').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) setColor(b.dataset.c); });
  $('#color-custom').addEventListener('input', (e) => setColor(e.target.value));
  $('#sizes').addEventListener('click', (e) => { const b = e.target.closest('.size'); if (b) setSize(+b.dataset.i); });
  $$('.tools [data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('#btn-undo').addEventListener('click', () => net.emit('draw:undo'));
  $('#btn-redo').addEventListener('click', () => net.emit('draw:redo'));
  $('#btn-clear').addEventListener('click', () => net.emit('draw:clear'));
  addEventListener('keydown', (e) => {
    if (!engine.enabled || e.target.matches('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); net.emit(e.shiftKey ? 'draw:redo' : 'draw:undo'); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); net.emit('draw:redo'); }
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (k === 'b') setTool('brush');
    else if (k === 'e') setTool('eraser');
    else if (k === 'f') setTool('fill');
    else if (k >= '1' && k <= '5') setSize(+k - 1);
  });
  addEventListener('resize', updateCursor);
  setColor(PALETTE[13]);
  setSize(1);
}

// ───────── Thanh trên ─────────
function hintHTML(t) {
  if (t.hidden) return '<div class="word-label">Đoán từ này</div><div class="word-title">Từ bí mật, đã ẩn độ dài</div>';
  const syls = [];
  let cur = [];
  t.mask.forEach((ch) => { if (ch === ' ') { syls.push(cur); cur = []; } else cur.push(ch); });
  syls.push(cur);
  const slots = syls.map((s) => `<span class="syl">${s.map((ch) => (ch === '_' ? '<span class="slot"></span>'
    : /[\p{L}\p{N}]/u.test(ch) ? `<span class="slot on">${esc(ch)}</span>` : `<span class="slot mark">${esc(ch)}</span>`)).join('')}</span>`).join('');
  const label = t.length ? `${t.length.syllables} tiếng, ${t.length.letters.join(' + ')} chữ cái` : 'Từ bí mật';
  return `<div class="word-label">Đoán từ này <span class="diff-chip ${esc(t.difficulty)}">${DIFF[t.difficulty] || ''}</span></div>
    <div class="hint" role="img" aria-label="${esc(label)}">${slots}<span class="hint-count" aria-hidden="true">${t.length ? t.length.letters.join(' ') : ''}</span></div>`;
}

function renderTop(st) {
  const t = st.turn;
  const amDrawer = !!t && t.drawerId === st.you;
  const drawerName = t ? (st.players.find((p) => p.id === t.drawerId)?.name || '') : '';
  $('#round-chip').textContent = st.phase === 'gameEnd' ? 'Hết trận' : `Hiệp ${st.round}/${st.settings.rounds}`;
  $('#round-chip').classList.toggle('idle', st.phase === 'lobby');
  let html;
  switch (st.phase) {
    case 'lobby': html = `<div class="word-label">Phòng chờ</div><div class="word-title">${esc(st.settings.name)}</div>`; break;
    case 'roundStart': html = `<div class="word-title">Hiệp ${st.round} bắt đầu</div>`; break;
    case 'choosing': html = `<div class="word-title">${amDrawer ? 'Chọn một từ để vẽ' : `${esc(drawerName)} đang chọn từ…`}</div>`; break;
    case 'drawing':
      html = t.word
        ? `<div class="word-label">${amDrawer ? 'Bạn đang vẽ' : 'Bạn đã đoán ra'}</div><div class="word-big">${esc(t.word)}</div>`
        : hintHTML(t);
      break;
    case 'turnEnd': html = `<div class="word-label">Đáp án</div><div class="word-big">${esc(t?.word || '')}</div>`; break;
    case 'gameEnd': html = '<div class="word-title">Kết thúc trận</div>'; break;
    default: html = '';
  }
  if (html !== wordHTML) { $('#word-area').innerHTML = html; wordHTML = html; }
}

function tick() {
  const st = S.state;
  const el = $('#timer');
  if (!st || st.phase === 'lobby' || !st.phaseEndsAt) { el.classList.add('idle'); el.classList.remove('warn', 'urgent'); return; }
  el.classList.remove('idle');
  const left = Math.max(0, st.phaseEndsAt - net.now());
  const total = Math.max(1, st.phaseMs || 1);
  const sec = Math.ceil(left / 1000);
  $('#timer-num').textContent = sec;
  $('#timer-ring').style.strokeDashoffset = String(119.4 * (1 - Math.min(1, left / total)));
  const drawing = st.phase === 'drawing';
  el.classList.toggle('warn', drawing && sec <= 20 && sec > 10);
  el.classList.toggle('urgent', drawing && sec <= 10);
  if (drawing && sec <= 10 && sec > 0 && sec !== lastTick) {
    lastTick = sec;
    sound.play('tick');
    if (rushTurn !== st.turn?.id) { rushTurn = st.turn?.id; flash('Còn 10 giây!', 'orange'); }
  }
  const c = $('#ov-count');
  if (c) c.textContent = sec;
}

// ───────── Lớp phủ trên bảng vẽ (do pha của server quyết định) ─────────
function keyFor(st) {
  const t = st.turn;
  switch (st.phase) {
    case 'roundStart': return `round:${st.round}`;
    case 'choosing':
      if (t.drawerId === st.you) return `choose:${t.id}:${S.options?.turnId === t.id ? 'ready' : 'wait'}`;
      return `chooser:${t.id}`;
    case 'turnEnd': return `end:${t?.id}:${S.turnEnd?.turnId === t?.id ? 'full' : 'basic'}`;
    case 'gameEnd': return `final:${st.hostId === st.you}:${S.final ? 'full' : 'basic'}`;
    default: return '';
  }
}

function overlayHTML(st) {
  const t = st.turn;
  const playerOf = (id) => st.players.find((p) => p.id === id);
  switch (st.phase) {
    case 'roundStart':
      return `<div class="ov"><p>Hiệp</p><div class="big-word">${st.round} / ${st.settings.rounds}</div><p>Chuẩn bị nhé!</p></div>`;
    case 'choosing': {
      if (t.drawerId !== st.you) {
        const d = playerOf(t.drawerId);
        return `<div class="ov"><div class="chooser">${avatarSVG(d?.avatar)}<h3>${esc(d?.name || 'Người vẽ')} đang chọn từ…</h3>
          <p>Còn <span id="ov-count">–</span> giây</p></div></div>`;
      }
      if (!S.options || S.options.turnId !== t.id) return '<div class="ov"><h3>Đang lấy từ cho bạn…</h3></div>';
      return `<div class="ov wide"><h3>Chọn một từ để vẽ</h3>
        <div class="choices">${S.options.options.map((o, i) => `
          <button type="button" class="choice" data-i="${i}">
            <span class="diff-chip ${esc(o.difficulty)}">${esc(o.label)}</span>
            <span class="w">${esc(o.word)}</span>
            <span class="meta">${esc(o.topic)}</span>
            <span class="pts">tối đa ${o.maxPoints} điểm</span>
          </button>`).join('')}</div>
        <div class="custom-word-area">
          <span class="custom-word-divider">HOẶC TỰ NHẬP TỪ MỚI</span>
          <form class="custom-word-form" id="custom-word-form" autocomplete="off">
            <input type="text" id="custom-word-input" maxlength="32" placeholder="Gõ từ bạn muốn vẽ…" autocomplete="off" spellcheck="false" enterkeyhint="go">
            <button type="submit" class="btn btn-green btn-small"><svg class="ic"><use href="#i-pencil"/></svg><span>Vẽ từ này</span></button>
          </form>
        </div>
        <p>Không chọn thì sau <span id="ov-count">–</span> giây sẽ tự chọn giúp bạn.</p></div>`;
    }
    case 'turnEnd': {
      const r = S.turnEnd && S.turnEnd.turnId === t?.id ? S.turnEnd : null;
      const title = r ? END_TITLE[r.reason] || 'Hết lượt' : 'Hết lượt';
      const word = r ? r.word : t?.word;
      const deltas = r ? `<ol class="deltas">${r.deltas.map((x) => {
        const p = playerOf(x.id);
        return `<li>${avatarSVG(p?.avatar)}<span class="nm">${esc(x.name)}${x.drawer ? '<span class="tag">vẽ</span>' : ''}</span>
          <b class="${x.delta > 0 ? 'pos' : x.delta < 0 ? 'neg' : 'zero'}">${x.delta > 0 ? '+' : ''}${x.delta}</b></li>`;
      }).join('')}</ol>` : '';
      return `<div class="ov"><h3>${esc(title)}</h3>${word ? `<p>Đáp án là</p><div class="big-word">${esc(word)}</div>` : ''}${deltas}</div>`;
    }
    case 'gameEnd': {
      const ranking = S.final?.ranking || [...st.players].sort((a, b) => b.score - a.score).map((p, i) => ({ ...p, rank: i + 1 }));
      const [a, b, c] = ranking;
      const step = (p, cls, n) => (p ? `<div class="step ${cls}">${avatarSVG(p.avatar)}<span class="nm">${esc(p.name)}</span><span class="sc">${p.score} điểm</span><div class="block">${n}</div></div>` : '');
      const me = ranking.find((p) => p.id === st.you);
      const isHost = st.hostId === st.you;
      const nameOf = (id) => ranking.find((p) => p.id === id)?.name || '';
      const titles = S.final?.titles?.length
        ? `<ul class="titles">${S.final.titles.map((x) => `<li><span class="tt">${esc(x.title)}</span><span class="td">${esc(nameOf(x.id))}: ${esc(x.desc)}</span></li>`).join('')}</ul>` : '';
      return `<div class="ov"><h3>${a ? `${esc(a.name)} vô địch!` : 'Kết thúc trận'}</h3>
        <div class="podium">${step(b, 'p2', 2)}${step(a, 'p1', 1)}${step(c, 'p3', 3)}</div>
        ${me ? `<p>Bạn về hạng ${me.rank} với ${me.score} điểm.</p>` : ''}
        ${titles}
        <div class="ov-actions">${isHost
          ? '<button type="button" class="btn btn-green" data-act="again">Chơi lại</button><button type="button" class="btn btn-white" data-act="lobby">Về phòng chờ</button>'
          : '<button type="button" class="btn btn-white" data-act="leave">Rời phòng</button>'}</div>
        <p>${isHost ? 'Không chọn gì thì cả phòng' : 'Chờ chủ phòng chọn chơi lại. Nếu không, cả phòng'} tự về phòng chờ sau <span id="ov-count">–</span> giây.</p></div>`;
    }
    default: return '';
  }
}

function renderOverlay(st) {
  const key = keyFor(st);
  if (key === overlayKey) return;
  overlayKey = key;
  const ov = $('#overlay');
  if (!key) { ov.className = 'overlay hidden'; ov.innerHTML = ''; return; }
  ov.className = `overlay k-${st.phase === 'choosing' && st.turn.drawerId === st.you ? 'choose' : st.phase}`;
  ov.innerHTML = overlayHTML(st);
  ov.scrollTop = 0;
  tick();
}

function confetti() {
  const box = $('#canvas-box');
  const wrap = document.createElement('div');
  wrap.className = 'confetti';
  const cols = ['#FF6B6B', '#FFD43B', '#51CF66', '#339AF0', '#9775FA', '#FF9A2E'];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = cols[i % cols.length];
    p.style.animationDuration = `${2.2 + Math.random() * 2}s`;
    p.style.animationDelay = `${Math.random() * 0.8}s`;
    wrap.append(p);
  }
  box.append(wrap);
  setTimeout(() => wrap.remove(), 5500);
}

// ───────── Toàn bộ màn chơi theo state ─────────
export function renderGame(st) {
  const t = st.turn;
  const amDrawer = !!t && t.drawerId === st.you;
  const me = st.players.find((p) => p.id === st.you);
  const inGame = st.phase !== 'lobby';
  $('#lobby-panel').classList.toggle('hidden', inGame);
  $('#board').classList.toggle('hidden', !inGame);

  const canDraw = st.phase === 'drawing' && amDrawer;
  const was = engine.enabled;
  engine.setEnabled(canDraw);
  if (canDraw && !was) setTool('brush');
  if (canDraw !== was) updateCursor();
  $('#toolbar').classList.toggle('hidden', !canDraw);
  // Chủ phòng dừng được trận đang chơi (về phòng chờ cho cả phòng)
  $('#btn-stop').classList.toggle('hidden', !(st.hostId === st.you && inGame && st.phase !== 'gameEnd'));

  const guessing = st.phase === 'drawing' && !amDrawer;
  $('#guess-bar').classList.toggle('hidden', !guessing);
  if (guessing) {
    $('#guess-hint').textContent = me?.status === 'guessed'
      ? 'Bạn đã đoán ra! Tin nhắn giờ chỉ người đã đoán ra mới thấy.'
      : st.settings.accentMode === 'strict' ? 'Gõ đáp án vào khung chat, nhớ gõ đúng dấu.' : 'Gõ đáp án vào khung chat. Có dấu hay không dấu đều được.';
    const rb = $('#btn-report');
    rb.disabled = !!t?.reportedByYou || me?.status === 'guessed';
    rb.querySelector('span').textContent = t?.reportedByYou ? 'Đã tố' : 'Tố viết chữ';
    // Thích / chưa thích bức vẽ: chấm một lần mỗi lượt
    for (const [id, kind] of [['#btn-like', 'like'], ['#btn-dislike', 'dislike']]) {
      const b = $(id);
      b.disabled = !!t?.ratedByYou;
      b.classList.toggle('chosen', t?.ratedByYou === kind);
    }
  }
  renderTop(st);
  renderOverlay(st);
  tick();
}

export function resetGameView() {
  overlayKey = '';
  wordHTML = '';
  S.options = null; S.turnEnd = null; S.final = null;
  const ov = $('#overlay');
  ov.className = 'overlay hidden'; ov.innerHTML = '';
  engine?.setEnabled(false);
}

export function initGame() {
  engine = new CanvasEngine($('#canvas'), {
    send: (e, d) => net.emit(e, d),
    onStroke: () => sound.scribble(),
    onDesync: requestResync,
  });
  net.on('canvas:sync', (d) => engine.render(d || {}));
  net.on('draw:start', (d) => engine.remoteStart(d));
  net.on('draw:pts', (d) => engine.remotePoints(d));
  net.on('draw:end', (d) => engine.remoteEnd(d));
  net.on('draw:action', (a) => engine.apply(a));
  initToolbar();

  $('#overlay').addEventListener('click', (e) => {
    const choice = e.target.closest('.choice');
    if (choice) { net.emit('word:choose', { index: +choice.dataset.i }); sound.play('pick'); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'again') net.emit('host:start');
    else if (b.dataset.act === 'lobby') net.emit('host:lobby');
    else if (b.dataset.act === 'leave') document.dispatchEvent(new CustomEvent('vevoi:leave'));
  });
  $('#overlay').addEventListener('submit', (e) => {
    if (e.target.id === 'custom-word-form') {
      e.preventDefault();
      const input = $('#custom-word-input');
      const text = input ? input.value.trim() : '';
      if (!text) return;
      if (text.length > 32) {
        flash('Từ quá dài (tối đa 32 ký tự)', 'red');
        return;
      }
      net.emit('word:choose', { customWord: text });
      sound.play('pick');
    }
  });
  $$('.guess-actions .rate').forEach((b) => b.addEventListener('click', () => {
    if (net.emit('draw:rate', { like: b.dataset.like === '1' })) { b.disabled = true; sound.play('pick'); }
  }));
  $('#btn-stop').addEventListener('click', async () => {
    const ok = await confirmBox({
      title: 'Dừng trận đấu?',
      text: 'Cả phòng sẽ về phòng chờ. Điểm của trận đang chơi không được tính.',
      ok: 'Dừng trận', danger: true,
    });
    if (ok) net.emit('host:stop');
  });
  $('#btn-report').addEventListener('click', async () => {
    const ok = await confirmBox({
      title: 'Tố người vẽ viết chữ?',
      text: 'Nếu một nửa số người đoán cùng tố, người vẽ mất lượt và bị trừ 100 điểm.',
      ok: 'Tố luôn', danger: true,
    });
    if (ok) net.emit('report');
  });

  net.on('turn:options', (d) => { S.options = d; sound.play('turn'); if (S.state) renderGame(S.state); });
  net.on('turn:end', (d) => { S.turnEnd = d; if (S.state) renderGame(S.state); });
  net.on('game:end', (d) => { S.final = d; if (S.state) renderGame(S.state); confetti(); });
  net.on('sfx', (d) => {
    if (d.name === 'correct') {
      sound.play(d.who === S.you ? 'correct' : 'other-correct');
      if (d.who === S.you) flash(d.pts ? `Chuẩn rồi! +${d.pts} điểm` : 'Chuẩn rồi!');
      return;
    }
    sound.play(d.name);
    if (d.name === 'hint' && S.state?.turn?.drawerId !== S.you) flash('Gợi ý: đã mở thêm một chữ cái', 'blue');
  });
  setInterval(tick, 200);
}
