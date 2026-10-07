// Âm thanh tổng hợp bằng Web Audio — không cần tệp mp3.
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* bỏ qua */ } },
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.sfxOn = store.get('vevoi.sfx', true);
    this.musicOn = store.get('vevoi.music', false);
    this.musicTimer = null;
    this.lastScribble = 0;
    const unlock = () => { this.ensure(); if (this.musicOn) this.startMusic(); };
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  tone(freq, { at = 0, dur = 0.12, type = 'sine', vol = 0.3, slide = 0 } = {}) {
    const ctx = this.ensure(); if (!ctx) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur = 0.05, vol = 0.04) {
    const ctx = this.ensure(); if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = 2400 + Math.random() * 1200; f.Q.value = 0.8;
    g.gain.value = vol;
    src.buffer = buf; src.connect(f); f.connect(g); g.connect(this.master); src.start();
  }

  play(name) {
    if (!this.sfxOn) return;
    const C = 523.25, E = 659.25, G = 783.99, C2 = 1046.5;
    switch (name) {
      case 'correct': [C, E, G, C2].forEach((f, i) => this.tone(f, { at: i * 0.07, dur: 0.18, type: 'triangle', vol: 0.25 })); break;
      case 'other-correct': this.tone(880, { dur: 0.1, type: 'triangle', vol: 0.18 }); this.tone(1320, { at: 0.08, dur: 0.12, type: 'triangle', vol: 0.15 }); break;
      case 'close': this.tone(440, { dur: 0.16, type: 'sine', vol: 0.2, slide: 120 }); break;
      case 'tick': this.tone(1200, { dur: 0.05, type: 'square', vol: 0.06 }); break;
      case 'turn': this.tone(G, { dur: 0.12, type: 'triangle' }); this.tone(C2, { at: 0.12, dur: 0.2, type: 'triangle' }); break;
      case 'start': [C, E, G, E, C2].forEach((f, i) => this.tone(f, { at: i * 0.1, dur: 0.16, type: 'square', vol: 0.12 })); break;
      case 'hint': this.tone(1500, { dur: 0.08, type: 'sine', vol: 0.15, slide: 400 }); break;
      case 'fail': this.tone(392, { dur: 0.2, type: 'sawtooth', vol: 0.08, slide: -150 }); this.tone(262, { at: 0.18, dur: 0.3, type: 'sawtooth', vol: 0.08, slide: -100 }); break;
      case 'turnEnd': this.tone(E, { dur: 0.12, type: 'triangle' }); this.tone(C, { at: 0.12, dur: 0.2, type: 'triangle' }); break;
      case 'win': [C, E, G, C2, G, C2].forEach((f, i) => this.tone(f, { at: i * 0.12, dur: 0.22, type: 'triangle', vol: 0.22 })); break;
      case 'join': this.tone(660, { dur: 0.08, vol: 0.12 }); this.tone(990, { at: 0.07, dur: 0.1, vol: 0.12 }); break;
      case 'msg': this.tone(1800, { dur: 0.03, type: 'sine', vol: 0.04 }); break;
      case 'pick': this.tone(700, { dur: 0.06, type: 'triangle', vol: 0.12 }); break;
      default: break;
    }
  }

  scribble() {
    if (!this.sfxOn) return;
    const now = performance.now();
    if (now - this.lastScribble < 90) return;
    this.lastScribble = now;
    this.noise(0.045, 0.025);
  }

  toggleSfx() { this.sfxOn = !this.sfxOn; store.set('vevoi.sfx', this.sfxOn); return this.sfxOn; }
  toggleMusic() {
    this.musicOn = !this.musicOn; store.set('vevoi.music', this.musicOn);
    if (this.musicOn) this.startMusic(); else this.stopMusic();
    return this.musicOn;
  }

  // Nhạc nền vui tươi: giai điệu ngũ cung lặp, âm lượng rất nhỏ
  startMusic() {
    if (this.musicTimer || !this.ensure()) return;
    const scale = [392, 440, 523.25, 587.33, 659.25, 783.99];
    const bass = [196, 220, 174.61, 261.63];
    const melody = [0, 2, 4, 2, 3, 1, 2, -1, 4, 5, 4, 2, 3, 2, 0, -1];
    let step = 0;
    const beat = 0.24;
    const tick = () => {
      if (!this.musicOn) return;
      const n = melody[step % melody.length];
      if (n >= 0) this.tone(scale[n], { dur: beat * 0.9, type: 'triangle', vol: 0.045 });
      if (step % 4 === 0) this.tone(bass[(step / 4) % bass.length], { dur: beat * 3.5, type: 'sine', vol: 0.05 });
      step++;
    };
    this.musicTimer = setInterval(tick, beat * 1000);
  }
  stopMusic() { clearInterval(this.musicTimer); this.musicTimer = null; }
}
