// Giới hạn tần suất kiểu "xô token": mỗi giây nạp `rate` token, chứa tối đa `burst`.
'use strict';

class Bucket {
  constructor(rate, burst, now = Date.now()) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.at = now;
  }
  take(n = 1, now = Date.now()) {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/** Nhóm xô theo khoá (ví dụ theo tên sự kiện, hoặc theo IP). Tự dọn khoá không dùng. */
class Limiter {
  constructor(table, { maxKeys = 10000 } = {}) {
    this.table = table;
    this.maxKeys = maxKeys;
    this.buckets = new Map();
  }
  take(key, kind = key) {
    let b = this.buckets.get(key);
    if (!b) {
      const [rate, burst] = Object.hasOwn(this.table, kind) ? this.table[kind] : this.table.default;
      if (this.buckets.size >= this.maxKeys) this.prune();
      b = new Bucket(rate, burst);
      this.buckets.set(key, b);
    }
    return b.take();
  }
  prune() {
    const now = Date.now();
    for (const [k, b] of this.buckets) if (now - b.at > 10 * 60000) this.buckets.delete(k);
    if (this.buckets.size >= this.maxKeys) this.buckets.clear();
  }
}

module.exports = { Bucket, Limiter };
