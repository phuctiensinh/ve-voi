// Engine vẽ phía client.
// - Hệ toạ độ logic 800×600 dùng chung mọi thiết bị; vẽ ở độ phân giải gấp đôi cho nét sắc trên màn hình mật độ cao.
// - Người vẽ thấy nét ngay (vẽ cục bộ), đồng thời gửi điểm theo lô ~25 lần/giây.
// - Người xem vẽ từng đoạn ngay khi nhận, nên thấy nét chạy liên tục chứ không đợi nhả chuột.
// - Mỗi nét có id do server cấp; nhận điểm của nét lạ (lỡ mất đầu nét) thì xin server ảnh chụp để đồng bộ lại.
export const W = 800, H = 600;
const SCALE = 2;
const WHITE = '#ffffff';
const MAX_BATCH = 500; // số giá trị toạ độ tối đa mỗi gói (server nhận tối đa 1200)

export class CanvasEngine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{send:(event:string,data:any)=>boolean, onStroke?:()=>void, onDesync?:()=>void}} opts
   */
  constructor(canvas, { send, onStroke, onDesync } = {}) {
    this.cv = canvas;
    this.cv.width = W * SCALE;
    this.cv.height = H * SCALE;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.send = send || (() => false);
    this.onStroke = onStroke || (() => {});
    this.onDesync = onDesync || (() => {});
    this.enabled = false;
    this.tool = 'brush';
    this.color = '#1d1d1d';
    this.size = 8;
    this.remote = null;
    this.local = null;
    this.buffer = [];
    this.clear();
    this.bindPointer();
  }

  reset() { this.ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0); }
  clear() { this.reset(); this.ctx.fillStyle = WHITE; this.ctx.fillRect(0, 0, W, H); }

  /** Vẽ lại toàn bộ từ ảnh chụp server; nếu có nét đang vẽ dở thì nối tiếp được. */
  render(snapshot) {
    this.clear();
    for (const a of snapshot.actions || []) this.apply(a);
    this.remote = null;
    const live = snapshot.live;
    if (live) {
      this.drawStroke(live.p, live.c, live.s);
      const n = live.p.length;
      this.remote = { id: live.id, c: live.c, s: live.s, last: n >= 2 ? [live.p[n - 2], live.p[n - 1]] : null };
    }
  }

  apply(a) {
    if (a.type === 'stroke') this.drawStroke(a.p, a.c, a.s);
    else if (a.type === 'fill') this.floodFill(a.x, a.y, a.c);
    else if (a.type === 'clear') this.clear();
  }

  drawStroke(p, color, size) {
    if (!p || p.length < 2) return;
    const c = this.ctx;
    this.reset();
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = size; c.lineCap = 'round'; c.lineJoin = 'round';
    if (p.length === 2) { c.beginPath(); c.arc(p[0], p[1], size / 2, 0, Math.PI * 2); c.fill(); return; }
    c.beginPath();
    c.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
    c.stroke();
  }

  segment(x0, y0, x1, y1, color, size) {
    const c = this.ctx;
    this.reset();
    c.strokeStyle = color; c.lineWidth = size; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }

  // ───── Nhận từ server (người xem) ─────
  remoteStart({ id, c, s }) { this.remote = { id, c, s, last: null }; }
  remotePoints({ id, p }) {
    const r = this.remote;
    if (!r || r.id !== id) { this.onDesync(); return; }
    for (let i = 0; i + 1 < p.length; i += 2) {
      const x = p[i], y = p[i + 1];
      if (!r.last) this.drawStroke([x, y], r.c, r.s);
      else this.segment(r.last[0], r.last[1], x, y, r.c, r.s);
      r.last = [x, y];
    }
  }
  remoteEnd({ id }) { if (this.remote && this.remote.id === id) this.remote = null; }

  // ───── Đổ màu: tô theo dòng quét trên pixel thật, có dung sai cho viền khử răng cưa ─────
  floodFill(lx, ly, hex) {
    const PW = W * SCALE, PH = H * SCALE;
    const x = Math.floor(lx * SCALE), y = Math.floor(ly * SCALE);
    if (x < 0 || y < 0 || x >= PW || y >= PH) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    const img = this.ctx.getImageData(0, 0, PW, PH);
    const d = img.data;
    const fr = parseInt(hex.slice(1, 3), 16), fg = parseInt(hex.slice(3, 5), 16), fb = parseInt(hex.slice(5, 7), 16);
    const i0 = (y * PW + x) * 4;
    const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2];
    if (Math.abs(tr - fr) < 3 && Math.abs(tg - fg) < 3 && Math.abs(tb - fb) < 3) { this.reset(); return; }
    const TOL = 64;
    const seen = new Uint8Array(PW * PH);
    const match = (p) => {
      const i = p * 4;
      return !seen[p] && Math.abs(d[i] - tr) <= TOL && Math.abs(d[i + 1] - tg) <= TOL && Math.abs(d[i + 2] - tb) <= TOL;
    };
    const paint = (p) => { const i = p * 4; d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255; seen[p] = 1; };
    const stack = [x, y];
    while (stack.length) {
      const cy = stack.pop();
      let cx = stack.pop();
      let p = cy * PW + cx;
      while (cx > 0 && match(p - 1)) { cx--; p--; }
      let up = false, down = false;
      while (cx < PW && match(p)) {
        paint(p);
        if (cy > 0) { if (match(p - PW)) { if (!up) { stack.push(cx, cy - 1); up = true; } } else up = false; }
        if (cy < PH - 1) { if (match(p + PW)) { if (!down) { stack.push(cx, cy + 1); down = true; } } else down = false; }
        cx++; p++;
      }
    }
    // Phủ thêm 1px viền sáng để không còn khe trắng lởm chởm quanh nét
    for (let p = 0; p < PW * PH; p++) {
      if (seen[p]) continue;
      const px = p % PW;
      if ((px > 0 && seen[p - 1] === 1) || (px < PW - 1 && seen[p + 1] === 1) || (p >= PW && seen[p - PW] === 1) || (p < PW * (PH - 1) && seen[p + PW] === 1)) {
        const i = p * 4;
        if (d[i] + d[i + 1] + d[i + 2] > 300) { d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255; seen[p] = 2; }
      }
    }
    this.ctx.putImageData(img, 0, 0);
    this.reset();
  }

  // ───── Người vẽ (mình) ─────
  pos(ev) {
    const r = this.cv.getBoundingClientRect();
    const x = Math.round(((ev.clientX - r.left) * W) / r.width);
    const y = Math.round(((ev.clientY - r.top) * H) / r.height);
    return [Math.max(-10, Math.min(W + 10, x)), Math.max(-10, Math.min(H + 10, y))];
  }

  bindPointer() {
    const cv = this.cv;
    cv.addEventListener('pointerdown', (ev) => {
      if (!this.enabled || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      ev.preventDefault();
      const [x, y] = this.pos(ev);
      if (this.tool === 'fill') {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        if (this.send('draw:fill', { x, y, c: this.color })) this.floodFill(x, y, this.color);
        this.onStroke('fill');
        return;
      }
      try { cv.setPointerCapture(ev.pointerId); } catch { /* bút cảm ứng cũ */ }
      const color = this.tool === 'eraser' ? WHITE : this.color;
      const size = this.tool === 'eraser' ? Math.max(this.size * 2, 14) : this.size;
      if (!this.send('draw:start', { c: color, s: size })) return;
      this.local = { c: color, s: size, last: [x, y], pointer: ev.pointerId };
      this.drawStroke([x, y], color, size);
      this.buffer.push(x, y);
      clearInterval(this.flushTimer);
      this.flushTimer = setInterval(() => this.flush(), 40);
    });
    cv.addEventListener('pointermove', (ev) => {
      if (!this.local || ev.pointerId !== this.local.pointer) return;
      const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [];
      for (const e of evs.length ? evs : [ev]) {
        const [x, y] = this.pos(e);
        const [lx, ly] = this.local.last;
        if (Math.abs(x - lx) + Math.abs(y - ly) < 2) continue;
        this.segment(lx, ly, x, y, this.local.c, this.local.s);
        this.local.last = [x, y];
        this.buffer.push(x, y);
      }
      this.onStroke('move');
    });
    const end = (ev) => { if (this.local && (!ev || ev.pointerId === this.local.pointer)) this.finishStroke(); };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('lostpointercapture', end);
  }

  finishStroke() {
    if (!this.local) return;
    clearInterval(this.flushTimer);
    this.flush();
    this.send('draw:end', {});
    this.local = null;
  }

  /** Gửi các điểm đang chờ theo từng gói nhỏ để server không phải cắt bớt. */
  flush() {
    while (this.buffer.length) this.send('draw:pts', { p: this.buffer.splice(0, MAX_BATCH) });
  }

  setEnabled(on) {
    if (this.enabled && !on) this.finishStroke();
    this.enabled = on;
    this.cv.classList.toggle('no-draw', !on);
  }
}
