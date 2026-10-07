// Phòng chờ: mã phòng & link mời, cài đặt (chỉ chủ phòng sửa được — server vẫn kiểm tra lại), nút bắt đầu.
import { $, $$, esc, toast, openModal } from './ui.js';
import { net } from './state.js';

const form = () => $('#settings');
const fe = (n) => form().elements.namedItem(n);
let timer = null;
let built = false;

function fillSelect(name, values, label) {
  const sel = fe(name);
  const cur = sel.value;
  sel.innerHTML = values.map((v) => `<option value="${v}">${esc(label(v))}</option>`).join('');
  if (cur) sel.value = cur;
}

function buildSelects(limits) {
  const range = ([lo, hi], step = 1) => Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  fillSelect('maxPlayers', range(limits.maxPlayers), (v) => `${v} người`);
  fillSelect('rounds', range(limits.rounds), (v) => `${v} hiệp`);
  fillSelect('drawTime', range(limits.drawTime, 10), (v) => `${v} giây`);
  fillSelect('wordCount', range(limits.wordCount), (v) => `${v} từ`);
  fillSelect('hints', range(limits.hints), (v) => (v === 0 ? 'Không gợi ý' : `${v} chữ cái`));
  built = true;
}

function readSettings() {
  const f = new FormData(form());
  return {
    name: f.get('name') || '',
    maxPlayers: +f.get('maxPlayers'), rounds: +f.get('rounds'), drawTime: +f.get('drawTime'),
    wordCount: +f.get('wordCount'), hints: +f.get('hints'),
    wordMode: f.get('wordMode'), accentMode: f.get('accentMode'),
    isPrivate: f.get('privacy') === 'private', password: f.get('password') || '',
    customWords: f.get('customWords') || '', customOnly: !!f.get('customOnly'),
    topics: $$('#topic-chips .topic.on').map((c) => c.dataset.t),
  };
}

function push(delay) {
  clearTimeout(timer);
  timer = setTimeout(() => net.emit('host:settings', { settings: readSettings() }), delay);
}

export function initLobby() {
  const f = form();
  f.addEventListener('submit', (e) => e.preventDefault());
  f.addEventListener('change', (e) => push(e.target.matches('select, input[type=checkbox]') ? 0 : 150));
  f.addEventListener('input', (e) => { if (e.target.matches('input:not([type=checkbox]), textarea')) push(700); });
  $('#topic-chips').addEventListener('click', (e) => {
    const c = e.target.closest('.topic');
    if (!c || c.disabled) return;
    c.classList.toggle('on');
    if (!$$('#topic-chips .topic.on').length) { c.classList.add('on'); toast('Cần bật ít nhất một chủ đề.'); }
    c.setAttribute('aria-pressed', String(c.classList.contains('on')));
    push(0);
  });
  $('#btn-start').addEventListener('click', () => net.emit('host:start'));

  const copy = async (text, ok) => {
    try { await navigator.clipboard.writeText(text); toast(ok); }
    catch {
      openModal(`<h3>Sao chép thủ công</h3><p>Trình duyệt không cho tự sao chép. Bôi đen rồi sao chép nhé:</p>
        <input value="${esc(text)}" readonly id="copy-field"><div class="row"><button type="button" class="btn btn-blue" data-close>Xong</button></div>`);
      const field = $('#copy-field'); field.focus(); field.select();
    }
  };
  $('#btn-copy-code').addEventListener('click', () => copy($('#room-code').textContent.trim(), 'Đã sao chép mã phòng.'));
  $('#btn-copy-link').addEventListener('click', async () => {
    const code = $('#room-code').textContent.trim();
    const url = `${location.origin}/r/${code}`;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: 'Vẽ Vời', text: `Vào vẽ đoán chữ với mình! Mã phòng: ${code}`, url }); return; } catch { /* người dùng huỷ */ }
    }
    copy(url, 'Đã sao chép link mời. Gửi cho hội bạn thôi!');
  });
}

/** Cập nhật phòng chờ theo state server; không ghi đè ô người chơi đang gõ. */
export function renderLobby(st) {
  if (!built) buildSelects(st.limits);
  const isHost = st.hostId === st.you;
  const s = st.settings;
  const focused = document.activeElement;
  const typing = isHost && form().contains(focused) && focused.matches('input:not([type=checkbox]), textarea');

  $('#room-code').textContent = st.code;
  if (!(typing && focused.name === 'name')) fe('name').value = s.name;
  if (!(typing && focused.name === 'password')) fe('password').value = isHost ? fe('password').value : (s.hasPassword ? '••••••' : '');
  if (!(typing && focused.name === 'customWords')) fe('customWords').value = isHost ? s.customWords.join(', ') : '';
  for (const k of ['maxPlayers', 'rounds', 'drawTime', 'wordCount', 'hints', 'wordMode', 'accentMode']) fe(k).value = String(s[k]);
  fe('privacy').value = s.isPrivate ? 'private' : 'public';
  fe('customOnly').checked = s.customOnly;
  $('#pw-field').classList.toggle('hidden', !s.isPrivate);
  $('#custom-count').textContent = s.customWordCount ? `(${s.customWordCount} từ)` : '';
  fe('customWords').placeholder = isHost ? 'Cách nhau bằng dấu phẩy. VD: sếp Tùng, deadline, trà chanh giã tay'
    : (s.customWordCount ? 'Chủ phòng đã thêm từ riêng (được giữ bí mật).' : 'Chủ phòng chưa thêm từ nào.');

  const sig = JSON.stringify([s.topics, isHost]);
  const chips = $('#topic-chips');
  if (chips.dataset.sig !== sig) {
    chips.innerHTML = Object.entries(st.topics).map(([k, v]) => {
      const on = s.topics.includes(k);
      return `<button type="button" class="topic${on ? ' on' : ''}" aria-pressed="${on}" data-t="${esc(k)}" ${isHost ? '' : 'disabled'}>${esc(v)}</button>`;
    }).join('');
    chips.dataset.sig = sig;
  }
  for (const el of form().elements) el.disabled = !isHost;
  $('#settings-note').classList.toggle('hidden', isHost);

  const n = st.players.filter((p) => p.connected).length;
  const btn = $('#btn-start');
  btn.classList.toggle('hidden', !isHost);
  btn.disabled = n < 2;
  const host = st.players.find((p) => p.id === st.hostId);
  $('#lobby-hint').textContent = isHost
    ? (n < 2 ? 'Cần ít nhất 2 người. Gửi link mời cho bạn bè nhé!' : `Đã có ${n} người. Sẵn sàng thì bấm bắt đầu!`)
    : `Đang chờ ${host ? host.name : 'chủ phòng'} bắt đầu trận…`;
}
