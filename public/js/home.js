// Trang chủ: biệt danh, avatar, chơi nhanh, tạo phòng, vào phòng bằng mã, danh sách phòng công khai.
import { $, $$, esc, icon, avatarSVG, AV_COLORS, AV_NAMES, toast, openModal, closeModal, busy } from './ui.js';
import { net, sound, S, token, profile, saveProfile, randomName } from './state.js';

let refreshTimer = null;

function renderProfile() {
  $('#av-preview').innerHTML = avatarSVG(profile.avatar, 'Avatar của bạn');
  $$('#av-colors .sw').forEach((b, i) => b.setAttribute('aria-checked', String(i === profile.avatar.color)));
}

/** Chưa có biệt danh thì tự đặt một cái vui vui để vào chơi ngay (vẫn sửa được). */
function ensureName() {
  if (!profile.name) {
    profile.name = randomName();
    $('#nick').value = profile.name;
    saveProfile();
  }
}

/** Gửi yêu cầu vào phòng và khoá nút cho tới khi server trả lời. */
export function request(btn, event, data) {
  if (S.pending) return;
  if (!net.emit(event, data)) { toast('Chưa kết nối được máy chủ, thử lại sau giây lát nhé.', { err: true }); return; }
  S.pending = btn;
  busy(btn, true);
  clearTimeout(S.pendingTimer);
  S.pendingTimer = setTimeout(() => {
    if (S.pending !== btn) return;
    doneRequest();
    toast('Máy chủ chưa phản hồi. Thử lại nhé.', { err: true });
  }, 8000);
}
export function doneRequest() {
  clearTimeout(S.pendingTimer);
  if (S.pending) busy(S.pending, false);
  S.pending = null;
}

export function joinRoom(code, password, btn = $('#btn-join')) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) { toast('Mã phòng gồm đúng 6 ký tự.', { err: true }); $('#join-code').focus(); return; }
  ensureName();
  S.joinCode = code;
  request(btn, 'room:join', { code, token, profile, password });
}

export function askPassword(code) {
  const m = openModal(`
    <h3>Phòng có mật khẩu</h3>
    <form method="dialog" id="pw-form">
      <label class="field"><span class="field-label">Mật khẩu phòng ${esc(code)}</span><input name="pw" maxlength="20" autocomplete="off" autofocus></label>
      <div class="row"><button type="button" class="btn btn-white" data-close>Huỷ</button><button class="btn btn-blue">Vào phòng</button></div>
    </form>`);
  m.querySelector('#pw-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const pw = new FormData(e.target).get('pw');
    closeModal();
    joinRoom(code, pw);
  });
}

export function renderRoomList(list) {
  const ul = $('#room-list');
  if (!Array.isArray(list) || !list.length) {
    ul.innerHTML = '<li class="empty">Chưa có phòng công khai nào. Bấm “Chơi ngay” để mở phòng đầu tiên.</li>';
    return;
  }
  ul.innerHTML = list.map((r) => {
    const full = r.players >= r.maxPlayers;
    const status = r.phase === 'lobby' ? '<span class="chip green">Đang chờ</span>'
      : r.phase === 'gameEnd' ? '<span class="chip blue">Vừa xong ván</span>'
        : `<span class="chip orange">Đang chơi, hiệp ${r.round}/${r.rounds}</span>`;
    return `<li class="room-row">
      <div>
        <div class="rr-name">${r.locked ? icon('lock') : ''}<span>${esc(r.name)}</span></div>
        <div class="rr-meta"><span>Chủ phòng: ${esc(r.host)}</span>${status}</div>
      </div>
      <span class="rr-count" title="Số người">${r.players}/${r.maxPlayers}</span>
      <button type="button" class="btn btn-small ${full ? 'btn-white' : 'btn-green'}" data-code="${esc(r.code)}" ${full ? 'disabled' : ''}>${full ? 'Đầy' : 'Vào'}</button>
    </li>`;
  }).join('');
}

export function startRoomListRefresh() {
  clearInterval(refreshTimer);
  net.emit('rooms:list');
  refreshTimer = setInterval(() => { if (S.screen === 'home') net.emit('rooms:list'); }, 10000);
}

export function initHome() {
  $('#av-colors').innerHTML = AV_COLORS.map((c, i) =>
    `<button type="button" class="sw" role="radio" style="--c:${c}" aria-label="${AV_NAMES[i]}" data-i="${i}"></button>`).join('');
  $('#av-colors').addEventListener('click', (e) => {
    const b = e.target.closest('.sw'); if (!b) return;
    profile.avatar.color = +b.dataset.i; saveProfile(); renderProfile(); sound.play('pick');
  });
  $('#av-prev').addEventListener('click', () => { profile.avatar.face = (profile.avatar.face + 15) % 16; saveProfile(); renderProfile(); sound.play('pick'); });
  $('#av-next').addEventListener('click', () => { profile.avatar.face = (profile.avatar.face + 1) % 16; saveProfile(); renderProfile(); sound.play('pick'); });
  $('#nick').value = profile.name;
  $('#nick').addEventListener('input', () => { profile.name = $('#nick').value.trim(); saveProfile(); });
  renderProfile();

  $('#btn-quick').addEventListener('click', (e) => { ensureName(); request(e.currentTarget, 'room:quick', { token, profile }); });
  $('#btn-create').addEventListener('click', (e) => {
    ensureName();
    request(e.currentTarget, 'room:create', { token, profile, settings: { name: `Phòng của ${profile.name}`, isPrivate: true } });
  });
  $('#btn-join').addEventListener('click', () => joinRoom($('#join-code').value));
  $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('#join-code').value); });
  $('#btn-refresh').addEventListener('click', () => net.emit('rooms:list'));
  $('#room-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-code]');
    if (b) joinRoom(b.dataset.code, undefined, b);
  });

  const sfx = $('#home-sfx'), music = $('#home-music');
  const syncSound = () => { sfx.checked = sound.sfxOn; music.checked = sound.musicOn; };
  sfx.addEventListener('change', () => { if (sfx.checked !== sound.sfxOn) sound.toggleSfx(); syncSound(); });
  music.addEventListener('change', () => { if (music.checked !== sound.musicOn) sound.toggleMusic(); syncSound(); });
  syncSound();

  net.on('rooms:list', renderRoomList);
}
