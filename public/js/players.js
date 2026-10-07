// Danh sách người chơi + menu thao tác (bỏ phiếu mời ra, ẩn tin nhắn, quyền chủ phòng).
import { $, esc, icon, avatarSVG, confirmBox, toast } from './ui.js';
import { net, S } from './state.js';

const prevScores = new Map();

export function renderPlayers(st) {
  const ranked = [...st.players].sort((a, b) => b.score - a.score);
  $('#player-count').textContent = `${st.players.length}/${st.settings.maxPlayers}`;
  $('#players').innerHTML = ranked.map((p, i) => {
    const prev = prevScores.get(p.id);
    const diff = prev === undefined ? 0 : p.score - prev;
    const me = p.id === st.you;
    const status = !p.connected ? '<span title="Mất kết nối">mất kết nối</span>'
      : p.status === 'drawing' ? `<span class="draw" title="Đang vẽ">${icon('pencil', 'draw')}</span>`
        : p.status === 'guessed' ? `<span title="Đã đoán ra">${icon('check', 'ok')}</span>` : '';
    return `<li><button type="button" class="pl st-${p.status}${p.connected ? '' : ' offline'}${me ? ' me' : ' clickable'}" data-id="${esc(p.id)}"
        aria-label="${esc(p.name)}, ${p.score} điểm${me ? ', là bạn' : ''}" ${me ? 'aria-disabled="true"' : 'aria-haspopup="menu"'}>
      <span class="rank">#${i + 1}</span>
      ${avatarSVG(p.avatar)}
      <span class="pl-info">
        <span class="pl-name">${p.id === st.hostId ? `<svg class="ic" aria-label="Chủ phòng"><use href="#i-crown"/></svg>` : ''}<span>${esc(p.name)}</span>${me ? '<span class="you">(bạn)</span>' : ''}${p.muted ? icon('mute') : ''}</span>
        <span class="pl-score">${p.score} điểm</span>
      </span>
      <span class="pl-status">${p.votes ? `<span class="votes" title="Phiếu mời ra">${p.votes}/${p.votesNeeded ?? '–'}</span>` : ''}${status}</span>
      ${diff ? `<span class="pl-delta ${diff < 0 ? 'neg' : ''}">${diff > 0 ? '+' : ''}${diff}</span>` : ''}
    </button></li>`;
  }).join('');
  prevScores.clear();
  for (const p of st.players) prevScores.set(p.id, p.score);
  if (menuFor && !st.players.some((p) => p.id === menuFor)) closeMenu();
  else if (menuFor) openMenu(menuFor, menuAnchor);
}

// ───────── Menu người chơi ─────────
let menuFor = null, menuAnchor = null;

export function closeMenu() {
  menuFor = null; menuAnchor = null;
  $('#player-menu').classList.add('hidden');
}

function openMenu(id, anchor) {
  const st = S.state;
  const p = st?.players.find((x) => x.id === id);
  if (!p || id === st.you) { closeMenu(); return; }
  menuFor = id; menuAnchor = anchor;
  const isHost = st.hostId === st.you;
  const hidden = S.hiddenPlayers.has(id);
  const voteLabel = p.votesNeeded === null ? 'Bỏ phiếu mời ra (cần ít nhất 3 người)'
    : p.votedByYou ? `Đã bỏ phiếu mời ra (${p.votes}/${p.votesNeeded})` : `Bỏ phiếu mời ra (${p.votes}/${p.votesNeeded})`;
  const menu = $('#player-menu');
  menu.innerHTML = `
    <div class="head">${avatarSVG(p.avatar)}<span>${esc(p.name)}</span></div>
    <button type="button" role="menuitem" data-act="vote" ${p.votedByYou || p.votesNeeded === null ? 'disabled' : ''}>${icon('flag')}${esc(voteLabel)}</button>
    <button type="button" role="menuitem" data-act="hide">${icon('eye-off')}${hidden ? 'Hiện lại tin nhắn của người này' : 'Ẩn tin nhắn của người này'}</button>
    ${isHost ? `
      <button type="button" role="menuitem" data-act="transfer" ${p.connected ? '' : 'disabled'}>${icon('crown')}Chuyển quyền chủ phòng</button>
      <button type="button" role="menuitem" data-act="mute">${icon(p.muted ? 'sound' : 'mute')}${p.muted ? 'Bật lại chat' : 'Tắt chat (vẫn đoán được)'}</button>
      <button type="button" role="menuitem" class="danger" data-act="kick">${icon('exit')}Mời ra khỏi phòng</button>
      <button type="button" role="menuitem" class="danger" data-act="ban">${icon('lock')}Cấm vào lại phòng</button>` : '<div class="note">Chủ phòng có thêm quyền mời ra, cấm và tắt chat.</div>'}`;
  menu.classList.remove('hidden');
  const row = document.querySelector(`.pl[data-id="${CSS.escape(id)}"]`) || (anchor?.isConnected ? anchor : null);
  menuAnchor = row;
  if (!row) { closeMenu(); return; }
  // Đặt menu bên phải dòng người chơi; không đủ chỗ thì đặt ngay bên dưới; luôn nằm trong màn hình
  const r = row.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = r.right + 8, top = r.top;
  if (left + mw > innerWidth - 8) { left = Math.min(Math.max(8, r.left), innerWidth - mw - 8); top = r.bottom + 6; }
  if (top + mh > innerHeight - 8) top = Math.max(8, innerHeight - mh - 8);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

export function initPlayers() {
  $('#players').addEventListener('click', (e) => {
    const b = e.target.closest('.pl.clickable');
    if (!b) return;
    if (menuFor === b.dataset.id) { closeMenu(); return; }
    openMenu(b.dataset.id, b);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menuFor) return;
    if (e.target.closest('#player-menu') || e.target.closest('.pl.clickable')) return;
    closeMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  addEventListener('resize', closeMenu);
  $('#players').addEventListener('scroll', closeMenu, { passive: true });

  $('#player-menu').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !menuFor) return;
    const p = S.state.players.find((x) => x.id === menuFor);
    if (!p) return closeMenu();
    const id = p.id;
    switch (b.dataset.act) {
      case 'vote': net.emit('vote:kick', { playerId: id }); closeMenu(); break;
      case 'hide':
        if (S.hiddenPlayers.has(id)) { S.hiddenPlayers.delete(id); toast(`Đã hiện lại tin nhắn của ${p.name}.`); }
        else { S.hiddenPlayers.add(id); toast(`Đã ẩn tin nhắn của ${p.name} (chỉ trên máy bạn).`); }
        closeMenu();
        break;
      case 'transfer':
        closeMenu();
        if (await confirmBox({ title: 'Chuyển quyền chủ phòng?', text: `${p.name} sẽ chỉnh được cài đặt, bắt đầu và dừng trận.`, ok: 'Chuyển quyền' })) net.emit('host:transfer', { playerId: id });
        break;
      case 'mute': net.emit('host:mute', { playerId: id, muted: !p.muted }); closeMenu(); break;
      case 'kick':
        closeMenu();
        if (await confirmBox({ title: `Mời ${p.name} ra?`, text: 'Người này phải chờ khoảng 1 phút mới vào lại được.', ok: 'Mời ra', danger: true })) net.emit('host:kick', { playerId: id });
        break;
      case 'ban':
        closeMenu();
        if (await confirmBox({ title: `Cấm ${p.name}?`, text: 'Người này sẽ không vào lại phòng này được nữa.', ok: 'Cấm vào lại', danger: true })) net.emit('host:ban', { playerId: id });
        break;
      default: break;
    }
  });
}
