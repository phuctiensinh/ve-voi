// Điểm vào client: nối các module, chuyển màn hình, xử lý kết nối / lỗi / bị mời ra.
import { $, $$, toast, confirmBox, closeModal } from './ui.js';
import { net, sound, S, token, profile } from './state.js';
import { initHome, joinRoom, askPassword, doneRequest, startRoomListRefresh } from './home.js';
import { initLobby, renderLobby } from './lobby.js';
import { initPlayers, renderPlayers, closeMenu } from './players.js';
import { initChat, clearChat, renderChatInput } from './chat.js';
import { initGame, renderGame, resetGameView } from './game.js';

// Lỗi bất ngờ trong giao diện: báo nhẹ nhàng thay vì để trang "chết" im lặng
let lastCrashToast = 0;
function onCrash(err) {
  console.error('[Vẽ Vời]', err);
  if (Date.now() - lastCrashToast > 10000) { lastCrashToast = Date.now(); toast('Có lỗi hiển thị. Nếu màn hình bị lạ, hãy tải lại trang.', { err: true }); }
}
addEventListener('error', (e) => onCrash(e.error || e.message));
addEventListener('unhandledrejection', (e) => onCrash(e.reason));

initHome();
initLobby();
initPlayers();
initChat();
initGame();

// ═════════ Chuyển màn hình ═════════
function show(screen) {
  S.screen = screen;
  $('#screen-home').classList.toggle('hidden', screen !== 'home');
  $('#screen-room').classList.toggle('hidden', screen !== 'room');
  syncAudioButtons();
}

function goHome(message, err = false) {
  doneRequest();
  S.you = null; S.code = null; S.state = null;
  resetGameView();
  closeMenu();
  closeModal();
  show('home');
  history.replaceState(null, '', '/');
  document.title = 'Vẽ Vời: vẽ hình đoán chữ cùng hội bạn';
  if (message) toast(message, { err });
  startRoomListRefresh();
}

function render(st) {
  document.title = `${st.settings.name} · Vẽ Vời`;
  renderPlayers(st);
  if (st.phase === 'lobby') renderLobby(st);
  renderGame(st);
  renderChatInput(st);
}

// ═════════ Sự kiện phòng ═════════
net.on('room:joined', (d) => {
  doneRequest();
  if (S.code !== d.code) { clearChat(); resetGameView(); }
  S.you = d.you; S.code = d.code;
  history.replaceState(null, '', `/r/${d.code}`);
  if (S.screen !== 'room') { show('room'); sound.play('join'); }
});
net.on('room:state', (st) => {
  if (!S.code || st.code !== S.code) return; // gói tin của phòng cũ còn trên đường
  S.state = st;
  S.you = st.you;
  if (S.screen !== 'room') show('room');
  render(st);
});
const FATAL = new Set(['ROOM_NOT_FOUND', 'ROOM_EXPIRED', 'BANNED', 'KICKED_RECENTLY', 'ROOM_FULL']);
net.on('room:error', (d) => {
  doneRequest();
  if (d.needPassword) { askPassword(S.joinCode || S.code); if (S.screen === 'room') goHome(); return; }
  if (S.screen === 'room' && FATAL.has(d.code)) { goHome(d.error, true); return; }
  toast(d.error || 'Không vào được phòng.', { err: true });
});
net.on('room:closed', (d) => goHome(d.reason || 'Phòng đã đóng.', true));
net.on('kicked', (d) => goHome(d.reason || 'Bạn đã bị mời ra khỏi phòng.', true));
net.on('room:left', () => { if (S.screen === 'room') goHome(); });
net.on('error:action', (d) => toast(d.message || 'Không thể làm việc này lúc này.', { err: true }));
net.on('toast', (d) => toast(d.msg));

async function leave() {
  if (S.state && S.state.phase !== 'lobby' && S.state.phase !== 'gameEnd') {
    const ok = await confirmBox({ title: 'Rời phòng?', text: 'Trận đang diễn ra. Rời bây giờ thì điểm của bạn trong ván này sẽ mất.', ok: 'Rời phòng', danger: true });
    if (!ok) return;
  }
  net.emit('room:leave');
  goHome();
}
$('#btn-leave').addEventListener('click', leave);
document.addEventListener('vevoi:leave', leave);

// ═════════ Âm thanh ═════════
function syncAudioButtons() {
  const sfx = $('#btn-sfx'), music = $('#btn-music');
  sfx.classList.toggle('off', !sound.sfxOn);
  sfx.querySelector('use').setAttribute('href', sound.sfxOn ? '#i-sound' : '#i-mute');
  sfx.setAttribute('aria-pressed', String(sound.sfxOn));
  music.classList.toggle('off', !sound.musicOn);
  music.setAttribute('aria-pressed', String(sound.musicOn));
  $('#home-sfx').checked = sound.sfxOn;
  $('#home-music').checked = sound.musicOn;
}
$('#btn-sfx').addEventListener('click', () => { sound.toggleSfx(); syncAudioButtons(); });
$('#btn-music').addEventListener('click', () => { sound.toggleMusic(); syncAudioButtons(); });
syncAudioButtons();

// ═════════ Tab trên điện thoại ═════════
$('#screen-room').classList.add('tab-chat');
$('#mobile-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  $$('#mobile-tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $('#screen-room').classList.toggle('tab-chat', b.dataset.tab === 'chat');
  $('#screen-room').classList.toggle('tab-players', b.dataset.tab === 'players');
});

// ═════════ Kết nối ═════════
let everOnline = false;
let bannerTimer = null;
function banner(state) {
  const b = $('#conn-banner');
  if (state === 'online') {
    clearTimeout(bannerTimer);
    if (everOnline && !b.classList.contains('hidden')) toast('Đã kết nối lại.');
    b.classList.add('hidden');
    everOnline = true;
    return;
  }
  const paint = () => {
    b.classList.remove('hidden');
    b.classList.toggle('down', state === 'down' || state === 'offline');
    $('#conn-text').textContent = state === 'offline' ? 'Thiết bị đang mất mạng. Có mạng lại là game tự nối tiếp.'
      : state === 'down' ? 'Không kết nối được máy chủ. Kiểm tra máy chủ game còn chạy không.'
        : everOnline ? 'Mất kết nối, đang nối lại…' : 'Đang kết nối tới máy chủ…';
    $('#conn-retry').classList.toggle('hidden', state !== 'down' && state !== 'offline');
  };
  if (everOnline || state === 'down' || state === 'offline') paint();
  else { clearTimeout(bannerTimer); bannerTimer = setTimeout(paint, 1500); }
}
net.on('status', ({ state }) => banner(state));
$('#conn-retry').addEventListener('click', () => net.retryNow());
net.on('disconnect', () => doneRequest());
net.on('connect', () => {
  if (S.code) net.emit('room:join', { code: S.code, token, profile });
  else if (S.autoJoin) { const c = S.autoJoin; S.autoJoin = null; joinRoom(c); }
  else if (S.screen === 'home') startRoomListRefresh();
});

// ═════════ Vào thẳng từ link mời /r/MÃPHÒNG ═════════
(function boot() {
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]{6})\/?$/);
  const code = m ? m[1].toUpperCase() : null;
  show('home');
  if (!code) { startRoomListRefresh(); return; }
  $('#join-code').value = code;
  if (profile.name) {
    if (net.state === 'online') joinRoom(code); else S.autoJoin = code;
  } else {
    toast('Đặt biệt danh rồi bấm “Vào phòng” nhé.', { ms: 4000 });
    $('#nick').focus();
  }
  startRoomListRefresh();
})();
