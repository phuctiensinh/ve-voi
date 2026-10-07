// Kết nối WebSocket: tự nối lại (lùi thời gian dần), nhịp tim phát hiện mạng chết, đồng bộ đồng hồ với server.
export class Net {
  constructor(path = '/ws') {
    const defaultHost = location.hostname.endsWith('.vercel.app') ? 've-voi.onrender.com' : location.host;
    const customHost = window.WS_SERVER_URL || localStorage.getItem('WS_SERVER_URL') || defaultHost;
    const cleanHost = customHost.replace(/^wss?:\/\//, '').replace(/\/$/, '');
    const proto = location.protocol === 'https:' || customHost.startsWith('wss:') ? 'wss' : 'ws';
    this.url = proto + '://' + cleanHost + (path.startsWith('/') ? path : '/' + path);
    this.handlers = new Map();
    this.ws = null;
    this.state = 'connecting';
    this.attempt = 0;
    this.offset = 0;     // đồng hồ server - đồng hồ máy (ms)
    this.bestRtt = Infinity;
    this.lastSeen = 0;
    this.retryTimer = null;
    addEventListener('online', () => this.retryNow());
    // Máy báo mất mạng (tắt Wi-Fi, vào hầm…): coi như mất kết nối ngay, khỏi chờ nhịp tim 20 giây
    addEventListener('offline', () => { if (this.ws) this.dropped(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.state !== 'online') this.retryNow(); });
    this.connect();
  }

  setState(state) {
    this.state = state;
    this.fire('status', { state, attempt: this.attempt });
  }

  connect() {
    clearTimeout(this.retryTimer);
    this.setState(this.attempt >= 4 ? 'down' : 'connecting');
    let ws;
    try { ws = new WebSocket(this.url); } catch { this.scheduleRetry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.lastSeen = Date.now();
      this.setState('online');
      this.startHeartbeat();
      this.ping();
      this.fire('connect');
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastSeen = Date.now();
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.e === 'pong:time') this.onPong(msg.d);
      this.fire(msg.e, msg.d);
    };
    ws.onclose = () => { if (this.ws === ws) this.dropped(); };
    ws.onerror = () => {};
  }

  /** Kết nối hiện tại coi như đã mất: báo cho giao diện và hẹn nối lại. */
  dropped() {
    const wasOnline = this.state === 'online';
    this.stopHeartbeat();
    if (this.ws) { this.ws.onopen = this.ws.onmessage = this.ws.onclose = null; try { this.ws.close(); } catch { /* đã đóng */ } }
    this.ws = null;
    if (wasOnline) this.fire('disconnect');
    this.scheduleRetry();
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    // Đang mất mạng hẳn: không thử vô ích, chờ sự kiện "online" rồi nối lại ngay
    if (navigator.onLine === false) { this.setState('offline'); return; }
    this.attempt++;
    this.setState(this.attempt >= 4 ? 'down' : 'connecting');
    const wait = Math.min(8000, 400 * 2 ** Math.min(this.attempt, 5)) + Math.random() * 300;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), wait);
  }

  retryNow() {
    if (this.state === 'online') return;
    clearTimeout(this.retryTimer);
    if (this.ws) { this.ws.onopen = this.ws.onmessage = this.ws.onclose = null; try { this.ws.close(); } catch { /* bỏ qua */ } this.ws = null; }
    this.connect();
  }

  // Nhịp tim: gửi ping mỗi 8 giây; 20 giây không nghe gì từ server thì coi như mạng đã chết và nối lại.
  startHeartbeat() {
    this.stopHeartbeat();
    this.hb = setInterval(() => {
      if (Date.now() - this.lastSeen > 20000) { this.dropped(); return; }
      this.ping();
    }, 8000);
  }
  stopHeartbeat() { clearInterval(this.hb); }
  ping() { this.emit('ping:time', { t: Date.now() }); }
  onPong(d) {
    const rtt = Date.now() - d.t;
    if (rtt <= this.bestRtt * 1.5 || rtt < 150) {
      this.bestRtt = Math.min(this.bestRtt, rtt);
      this.offset = d.server + rtt / 2 - Date.now();
    }
  }
  /** Giờ hiện tại theo đồng hồ server (để đếm ngược khớp nhau trên mọi máy). */
  now() { return Date.now() + this.offset; }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }
  fire(event, data) {
    for (const fn of this.handlers.get(event) || []) {
      try { fn(data); } catch (err) { console.error('[Vẽ Vời] lỗi xử lý sự kiện', event, err); }
    }
  }
  /** Gửi sự kiện; trả về false nếu đang mất kết nối (không xếp hàng để tránh gửi thao tác cũ). */
  emit(event, data) {
    if (this.state !== 'online' || !this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify({ e: event, d: data }));
    return true;
  }
}
