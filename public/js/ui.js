// Thành phần giao diện dùng chung: avatar tròn, biểu tượng, thông báo, hộp thoại.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const fmtTime = (ts) => new Date(ts || Date.now()).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

// 12 màu avatar (khớp chỉ số 0–11 phía server)
export const AV_COLORS = ['#FF6B6B', '#FFA94D', '#FFD43B', '#69DB7C', '#4DABF7', '#9775FA', '#F783AC', '#38D9A9', '#A9E34B', '#748FFC', '#E599F7', '#DEE2E6'];
export const AV_NAMES = ['Đỏ san hô', 'Cam', 'Vàng', 'Xanh lá', 'Xanh trời', 'Tím', 'Hồng', 'Ngọc', 'Chanh', 'Xanh chàm', 'Hồng tím', 'Xám'];

const INK = '#1D2433';
// 4 kiểu mắt × 4 kiểu miệng = 16 khuôn mặt
const EYES = [
  `<circle cx="36" cy="45" r="10" fill="#fff" stroke="${INK}" stroke-width="3.5"/><circle cx="64" cy="45" r="10" fill="#fff" stroke="${INK}" stroke-width="3.5"/><circle cx="39" cy="47" r="4.5" fill="${INK}"/><circle cx="67" cy="47" r="4.5" fill="${INK}"/>`,
  `<rect x="22" y="37" width="24" height="15" rx="6" fill="${INK}"/><rect x="54" y="37" width="24" height="15" rx="6" fill="${INK}"/><path d="M46 42h8" stroke="${INK}" stroke-width="3.5"/><path d="M27 42l6-2.5M59 42l6-2.5" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".8"/>`,
  `<path d="M27 48q8-10 16 0M57 48q8-10 16 0" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
  `<ellipse cx="36" cy="45" rx="5" ry="6.5" fill="${INK}"/><ellipse cx="64" cy="45" rx="5" ry="6.5" fill="${INK}"/><circle cx="37.6" cy="43" r="1.7" fill="#fff"/><circle cx="65.6" cy="43" r="1.7" fill="#fff"/><ellipse cx="25" cy="58" rx="6" ry="4" fill="#FF7A9C" opacity=".55"/><ellipse cx="75" cy="58" rx="6" ry="4" fill="#FF7A9C" opacity=".55"/>`,
];
const MOUTHS = [
  `<path d="M33 62q17 20 34 0z" fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M38 63.5h24v4H38z" fill="#fff"/>`,
  `<ellipse cx="50" cy="68" rx="8" ry="9" fill="${INK}"/><ellipse cx="50" cy="73" rx="5" ry="3" fill="#FF7A9C"/>`,
  `<path d="M37 66q13 9 26-4" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`,
  `<path d="M45 67q-1 12 6 12t6-12z" fill="#FF7A9C" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M34 63q16 12 32 0" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`,
];

/** Avatar tròn: màu nền + khuôn mặt (chỉ số 0–15 = mắt × miệng). */
export function avatarSVG(av, label = '') {
  const color = AV_COLORS[av?.color ?? 0] || AV_COLORS[0];
  const f = Math.abs(av?.face ?? 0) % 16;
  return `<svg class="av" viewBox="0 0 100 100" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}>`
    + `<circle cx="50" cy="50" r="46" fill="${color}"/>`
    + '<path d="M8 56a42 42 0 0 0 84 0a46 46 0 0 1-84 0z" fill="#000" opacity=".08"/>'
    + '<ellipse cx="33" cy="22" rx="13" ry="7" fill="#fff" opacity=".35" transform="rotate(-22 33 22)"/>'
    + EYES[f % 4] + MOUTHS[Math.floor(f / 4)]
    + '<circle cx="50" cy="50" r="46" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="3"/>'
    + '</svg>';
}

// ───────── Thông báo ngắn ─────────
export function toast(msg, { err = false, ms = 2800 } = {}) {
  const box = $('#toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.textContent = msg;
  box.append(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), ms);
}

// ───────── Hộp thoại ─────────
const modal = () => $('#modal');
export function openModal(html) {
  const m = modal();
  m.innerHTML = html;
  m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
  if (!m.open) m.showModal();
  (m.querySelector('[autofocus]') || m.querySelector('input, select, textarea, .btn'))?.focus();
  return m;
}
export function closeModal() { const m = modal(); if (m.open) m.close(); }

/** Hộp xác nhận thay cho confirm() mặc định của trình duyệt. */
export function confirmBox({ title, text, ok = 'Đồng ý', cancel = 'Huỷ', danger = false }) {
  return new Promise((resolve) => {
    const m = openModal(`<h3>${esc(title)}</h3><p>${esc(text)}</p>
      <div class="row"><button type="button" class="btn btn-white" data-no>${esc(cancel)}</button>
      <button type="button" class="btn ${danger ? 'btn-red' : 'btn-blue'}" data-yes autofocus>${esc(ok)}</button></div>`);
    let done = false;
    const finish = (v) => { if (done) return; done = true; closeModal(); resolve(v); };
    m.querySelector('[data-yes]').addEventListener('click', () => finish(true));
    m.querySelector('[data-no]').addEventListener('click', () => finish(false));
    m.addEventListener('close', () => finish(false), { once: true });
  });
}

/** Đặt nút vào trạng thái đang xử lý (vô hiệu + vòng quay) cho tới khi gọi hàm trả về. */
export function busy(btn, on = true) {
  if (!btn) return;
  btn.classList.toggle('loading', on);
  btn.disabled = on;
}
