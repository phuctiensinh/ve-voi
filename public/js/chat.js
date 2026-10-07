// Khung trò chuyện: server quyết định ai nhận tin nào; ở đây chỉ hiển thị (luôn bằng textContent / esc, không chèn HTML thô).
import { $, esc, fmtTime } from './ui.js';
import { net, S, sound } from './state.js';

const box = () => $('#chat');

export function initChat() {
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const v = input.value.trim();
    if (!v) return;
    if (!net.emit('chat', { text: v })) return; // mất kết nối: giữ nguyên chữ để gửi lại sau
    input.value = '';
  });
  net.on('chat:msg', addMessage);
}

export function clearChat() { box().innerHTML = ''; }

function line(cls, html, ts) {
  const li = document.createElement('li');
  li.className = cls;
  li.innerHTML = html;
  if (ts) li.title = fmtTime(ts);
  return li;
}

export function addMessage(m) {
  if (!m || typeof m !== 'object') return;
  if ((m.type === 'chat' || m.type === 'insider') && S.hiddenPlayers.has(m.from)) return;
  let li;
  switch (m.type) {
    case 'system':
      li = m.kind === 'reveal'
        ? line('sys k-reveal', `Đáp án: <b>${esc(m.word)}</b>`, m.ts)
        : line(`sys k-${esc(m.kind || 'info')}`, esc(m.text), m.ts);
      break;
    case 'correct': li = line('correct', esc(m.text), m.ts); break;
    case 'close': li = line('close', `“${esc(m.guess)}” gần đúng rồi! ${esc(m.text)}`, m.ts); sound.play('close'); break;
    case 'accent': li = line('accent', `“${esc(m.guess)}”: ${esc(m.text)}`, m.ts); sound.play('close'); break;
    case 'private': li = line('private', esc(m.text), m.ts); break;
    case 'insider':
      li = line('insider', `<span class="tag">khán giả</span><span class="who">${esc(m.name)}:</span> ${esc(m.text)}`, m.ts);
      li.title = `${fmtTime(m.ts)} · Chỉ người vẽ và người đã đoán ra thấy tin này`;
      break;
    default: {
      const mine = m.from === S.you;
      if (m.muted) li = line('echo', `<span class="tag">chỉ bạn thấy</span><span class="who">${esc(m.name)}:</span> ${esc(m.text)}`, m.ts);
      else li = line(mine ? 'me' : '', `<span class="who">${esc(m.name)}:</span> ${esc(m.text)}`, m.ts);
      if (!mine) sound.play('msg');
    }
  }
  const b = box();
  const stick = b.scrollHeight - b.scrollTop - b.clientHeight < 80;
  b.append(li);
  while (b.children.length > 250) b.firstChild.remove();
  if (stick) b.scrollTop = b.scrollHeight;
}

/** Gợi ý trong ô nhập theo vai trò hiện tại. */
export function renderChatInput(st) {
  const me = st.players.find((p) => p.id === st.you);
  const drawing = st.phase === 'drawing';
  const amDrawer = st.turn?.drawerId === st.you;
  $('#chat-input').placeholder = !drawing ? 'Nhắn gì đó…'
    : amDrawer ? 'Chat với người đã đoán ra…'
      : me?.status === 'guessed' ? 'Chat với người đã đoán ra…'
        : 'Gõ đáp án vào đây…';
}
