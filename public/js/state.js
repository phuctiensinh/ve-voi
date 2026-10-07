// Trạng thái dùng chung của client. Client KHÔNG tự quyết định luật chơi: mọi thứ hiển thị đều lấy từ state server gửi.
import { Net } from './net.js';
import { Sound } from './sound.js';

export const net = new Net('/ws');
export const sound = new Sound();

export const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* trình duyệt chặn lưu trữ */ } },
};

// Mã định danh phiên: dùng để nối lại đúng người chơi khi tải lại trang / rớt mạng
export const token = ls.get('vevoi.token', null) || (() => {
  const t = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
  ls.set('vevoi.token', t);
  return t;
})();

const ADJ = ['Mập', 'Lười', 'Ú', 'Lém', 'Ngố', 'Xinh', 'Vui', 'Nhí', 'Lanh', 'Hề'];
const ANIMAL = ['Mèo', 'Gấu', 'Cá Vàng', 'Thỏ', 'Cún', 'Vịt', 'Heo', 'Cú', 'Sóc', 'Khỉ'];
export const randomName = () => `${ANIMAL[Math.floor(Math.random() * ANIMAL.length)]} ${ADJ[Math.floor(Math.random() * ADJ.length)]}`;

export const profile = ls.get('vevoi.profile', null) || {
  name: '', avatar: { face: Math.floor(Math.random() * 16), color: Math.floor(Math.random() * 12) },
};
export function saveProfile() { ls.set('vevoi.profile', profile); }

/** Trạng thái giao diện (không phải trạng thái game). */
export const S = {
  screen: 'home',
  you: null,
  code: null,
  state: null,         // room:state mới nhất từ server (đã lọc riêng cho mình)
  options: null,       // các từ để chọn (chỉ khi mình là người vẽ)
  turnEnd: null,       // kết quả lượt vừa xong
  final: null,         // kết quả trận
  hiddenPlayers: new Set(), // người chơi mình đã ẩn tin nhắn (chỉ trên máy mình)
  pending: null,       // nút đang chờ server phản hồi
};
