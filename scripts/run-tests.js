#!/usr/bin/env node
// "npm test": chạy mọi file test/**/*.test.js bằng node:test có sẵn trong Node (không cần thư viện ngoài).
// Liệt kê file tường minh để chạy giống nhau trên Node 18/20/22 và trên Windows (cmd không tự mở rộng dấu *).
// Tuỳ chọn: "npm test -- canvas" hoặc "npm test -- vietnamese rules" để chỉ chạy file có tên chứa chuỗi đó.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const find = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return find(p);
  return e.name.endsWith('.test.js') ? [p] : [];
});

const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
let files = find(path.join(ROOT, 'test')).sort();
if (filters.length) files = files.filter((f) => filters.some((x) => f.split(path.sep).join('/').includes(x)));
if (!files.length) { console.error('Không tìm thấy file test nào khớp.'); process.exit(1); }

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18) { console.error(`Cần Node.js 18 trở lên (đang dùng ${process.versions.node}).`); process.exit(1); }
const args = ['--test'];
// Test tích hợp dùng hẹn giờ thật: chạy lần lượt từng file cho ổn định (tuỳ chọn có từ Node 20.10)
if (major > 20 || (major === 20 && minor >= 10)) args.push('--test-concurrency=1');
const r = spawnSync(process.execPath, [...args, ...files], { stdio: 'inherit', cwd: ROOT });
process.exit(r.status === null ? 1 : r.status);
