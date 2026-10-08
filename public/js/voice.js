// Voice chat: WebRTC dạng lưới (mỗi cặp người chơi nối thẳng với nhau), server chỉ chuyển offer/answer/ICE.
// Ai đang bật voice lấy từ room:state (players[].voice); người có id nhỏ hơn là bên gửi offer để hai bên không giành nhau.
import { $, toast } from './ui.js';
import { net, S } from './state.js';

// Có thể ghi đè (vd. thêm máy chủ TURN) bằng window.VOICE_ICE_SERVERS trước khi tải trang
const ICE_SERVERS = window.VOICE_ICE_SERVERS || [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

let on = false;          // người dùng muốn bật voice
let sent = false;        // đã gửi voice:join, đang chờ server xác nhận
let confirmed = false;   // server đã ghi nhận mình đang trong voice
let starting = false;    // đang xin quyền micro
let micOff = false;
let stream = null;
const peers = new Map(); // playerId → { pc, audio, queue: RTCIceCandidateInit[], level }

// ───────── Phát hiện ai đang nói (để tô sáng trong danh sách người chơi) ─────────
let actx = null, meter = null, timer = null;
function watchLevel(id, mediaStream) {
  try {
    actx = actx || new AudioContext();
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    const an = actx.createAnalyser();
    an.fftSize = 512;
    actx.createMediaStreamSource(mediaStream).connect(an);
    return { an, buf: new Uint8Array(an.fftSize) };
  } catch { return null; }
}
function loud(level) {
  if (!level) return false;
  level.an.getByteTimeDomainData(level.buf);
  let sum = 0;
  for (const v of level.buf) sum += (v - 128) ** 2;
  return Math.sqrt(sum / level.buf.length) > 4;
}
function tick() {
  const speaking = new Set();
  if (meter && !micOff && loud(meter)) speaking.add(S.you);
  for (const [id, p] of peers) if (loud(p.level)) speaking.add(id);
  for (const el of document.querySelectorAll('.pl[data-id]')) el.classList.toggle('speaking', speaking.has(el.dataset.id));
}

// ───────── Bật / tắt ─────────
async function start() {
  if (on || starting) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    toast('Trình duyệt này không hỗ trợ voice chat (cần HTTPS và trình duyệt mới).', { err: true });
    return;
  }
  starting = true;
  render();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    starting = false;
    render();
    toast(err?.name === 'NotAllowedError' ? 'Bạn chưa cho phép dùng micro. Bấm biểu tượng ổ khoá trên thanh địa chỉ để cấp quyền.'
      : 'Không mở được micro. Kiểm tra lại thiết bị nhé.', { err: true });
    return;
  }
  starting = false;
  if (!S.code) { stopTracks(); render(); return; } // đã rời phòng trong lúc chờ quyền
  on = true; micOff = false; sent = false; confirmed = false;
  meter = watchLevel(S.you, stream);
  clearInterval(timer);
  timer = setInterval(tick, 150);
  syncVoice(S.state);
}

function stopTracks() {
  for (const t of stream?.getTracks() || []) t.stop();
  stream = null;
}

/** Rời voice (bấm nút, rời phòng, hoặc bị chủ phòng tắt chat). */
export function stopVoice(message) {
  if (!on && !starting) return;
  if (on && (sent || confirmed)) net.emit('voice:leave');
  on = false; sent = false; confirmed = false; micOff = false;
  closeAll();
  stopTracks();
  meter = null;
  clearInterval(timer); timer = null;
  for (const el of document.querySelectorAll('.pl.speaking')) el.classList.remove('speaking');
  render();
  if (message) toast(message, { err: true });
}

function toggleMic() {
  if (!stream) return;
  micOff = !micOff;
  for (const t of stream.getAudioTracks()) t.enabled = !micOff;
  render();
}

// ───────── Kết nối từng người ─────────
function closePeer(id) {
  const p = peers.get(id);
  if (!p) return;
  peers.delete(id);
  p.pc.onicecandidate = p.pc.ontrack = p.pc.onconnectionstatechange = null;
  try { p.pc.close(); } catch { /* đã đóng */ }
  p.audio.srcObject = null;
}
function closeAll() { for (const id of [...peers.keys()]) closePeer(id); }

function makePeer(id) {
  closePeer(id);
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const audio = new Audio();
  audio.autoplay = true;
  const peer = { pc, audio, queue: [], level: null };
  peers.set(id, peer);
  for (const t of stream.getTracks()) pc.addTrack(t, stream);
  pc.onicecandidate = (e) => { if (e.candidate) net.emit('voice:signal', { to: id, candidate: e.candidate.toJSON() }); };
  pc.ontrack = (e) => {
    const ms = e.streams[0] || new MediaStream([e.track]);
    audio.srcObject = ms;
    audio.play().catch(() => {});
    peer.level = watchLevel(id, ms);
  };
  pc.onconnectionstatechange = () => {
    // Mất kết nối hẳn: đóng lại, lần đồng bộ sau bên gửi offer sẽ tạo kết nối mới
    if (pc.connectionState === 'failed' && peers.get(id)?.pc === pc) { closePeer(id); setTimeout(() => syncVoice(S.state), 1500); }
  };
  return peer;
}

async function offer(id) {
  const { pc } = makePeer(id);
  try {
    await pc.setLocalDescription(await pc.createOffer());
    net.emit('voice:signal', { to: id, sdp: { type: 'offer', sdp: pc.localDescription.sdp } });
  } catch { closePeer(id); }
}

async function onSignal(d) {
  if (!on || !confirmed || !d || typeof d.from !== 'string') return;
  const id = d.from;
  try {
    if (d.sdp?.type === 'offer') {
      const peer = makePeer(id);
      await peer.pc.setRemoteDescription(d.sdp);
      await flush(peer);
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      net.emit('voice:signal', { to: id, sdp: { type: 'answer', sdp: peer.pc.localDescription.sdp } });
    } else if (d.sdp?.type === 'answer') {
      const peer = peers.get(id);
      if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
      await peer.pc.setRemoteDescription(d.sdp);
      await flush(peer);
    } else if (d.candidate) {
      const peer = peers.get(id);
      if (!peer) return;
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(d.candidate);
      else peer.queue.push(d.candidate);
    }
  } catch { /* tín hiệu cũ hoặc hỏng: bỏ qua */ }
}
async function flush(peer) {
  for (const c of peer.queue.splice(0)) { try { await peer.pc.addIceCandidate(c); } catch { /* bỏ qua */ } }
}

// ───────── Đồng bộ theo room:state ─────────
export function syncVoice(st) {
  render(st);
  if (!on || !st) return;
  const me = st.players.find((p) => p.id === st.you);
  if (!me) return;
  if (me.voice) { sent = false; confirmed = true; }
  else if (confirmed) { stopVoice(me.muted ? 'Chủ phòng đã tắt chat của bạn nên mic cũng bị tắt.' : null); return; }
  else if (!sent) {
    if (me.muted) { stopVoice('Chủ phòng đã tắt chat của bạn nên không bật mic được.'); return; }
    sent = net.emit('voice:join');
  }
  if (!confirmed) return;
  const others = new Set(st.players.filter((p) => p.voice && p.connected && p.id !== st.you).map((p) => p.id));
  for (const id of [...peers.keys()]) if (!others.has(id)) closePeer(id);
  for (const id of others) if (!peers.has(id) && st.you < id) offer(id);
}

function render(st = S.state) {
  const btn = $('#btn-voice'), mic = $('#btn-mic');
  if (!btn) return;
  btn.classList.toggle('btn-red', on);
  btn.classList.toggle('btn-white', !on);
  btn.classList.toggle('loading', starting);
  btn.querySelector('span').textContent = on ? 'Rời voice' : 'Vào voice';
  btn.setAttribute('aria-pressed', String(on));
  mic.classList.toggle('hidden', !on);
  mic.classList.toggle('off', micOff);
  mic.querySelector('use').setAttribute('href', micOff ? '#i-mic-off' : '#i-mic');
  mic.setAttribute('aria-label', micOff ? 'Bật mic' : 'Tắt mic');
  mic.title = micOff ? 'Bật mic' : 'Tắt mic';
  const n = st ? st.players.filter((p) => p.voice && p.connected).length : 0;
  $('#voice-count').textContent = n ? `${n} người đang trong voice` : 'Nói chuyện bằng giọng';
}

export function initVoice() {
  $('#btn-voice').addEventListener('click', () => (on ? stopVoice() : start()));
  $('#btn-mic').addEventListener('click', toggleMic);
  net.on('voice:signal', onSignal);
  // Rớt mạng: server đã gỡ mình khỏi voice; giữ mic, khi vào lại phòng sẽ tự xin vào voice lại
  net.on('disconnect', () => { if (on) { closeAll(); sent = false; confirmed = false; } });
  net.on('error:action', (d) => { if (d?.event === 'voice:join') stopVoice(); });
  render();
}
