#!/usr/bin/env node
// "npm run build": game chạy thẳng mã nguồn (client là ES module, không cần đóng gói),
// nên bước build là KIỂM TRA toàn bộ dự án trước khi chạy / triển khai:
//   1. cú pháp mọi file JS (máy chủ CommonJS + giao diện ES module)
//   2. import giữa các module giao diện trỏ đúng file và đúng tên được export
//   3. index.html: tài nguyên tồn tại, không có script nội tuyến (CSP chặn), mọi id/icon mà JS dùng đều có thật
//   4. các module máy chủ nạp được, ngân hàng từ hợp lệ
// Lỗi → in rõ ràng và thoát với mã 1.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const problems = [];
const fail = (msg) => problems.push(msg);
let checks = 0;

function walk(dir, filter) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}
const read = (p) => fs.readFileSync(p, 'utf8');

// ───────── 1. Cú pháp ─────────
const serverFiles = [...walk(path.join(ROOT, 'server'), (p) => p.endsWith('.js')),
  ...walk(path.join(ROOT, 'scripts'), (p) => p.endsWith('.js')),
  ...walk(path.join(ROOT, 'test'), (p) => p.endsWith('.js'))];
const clientDir = path.join(ROOT, 'public', 'js');
const clientFiles = walk(clientDir, (p) => p.endsWith('.js'));

function syntaxCheck(file, asModule) {
  let target = file;
  let tmp = null;
  if (asModule) { // node --check coi .js là CommonJS → chép ra .mjs để kiểm tra đúng cú pháp ES module
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vevoi-check-'));
    target = path.join(tmp, path.basename(file, '.js') + '.mjs');
    fs.copyFileSync(file, target);
  }
  const r = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  checks++;
  if (r.status !== 0) fail(`Lỗi cú pháp trong ${rel(file)}:\n${(r.stderr || '').trim().split('\n').slice(0, 6).join('\n')}`);
}
serverFiles.forEach((f) => syntaxCheck(f, false));
clientFiles.forEach((f) => syntaxCheck(f, true));

// Ký tự vô hình / đảo chiều chữ lọt vào mã nguồn (dễ gây lỗi khó thấy)
const INVISIBLE = /[\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;
for (const f of [...serverFiles, ...clientFiles, path.join(ROOT, 'public', 'index.html'), path.join(ROOT, 'public', 'style.css')]) {
  checks++;
  const lines = read(f).split('\n');
  lines.forEach((line, i) => { if (INVISIBLE.test(line)) fail(`${rel(f)}:${i + 1} có ký tự vô hình (U+${line.match(INVISIBLE)[0].codePointAt(0).toString(16).toUpperCase()})`); });
}

// ───────── 2. Import / export giữa các module giao diện ─────────
const exportsOf = (src) => {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
  return names;
};
for (const f of clientFiles) {
  const src = read(f);
  for (const m of src.matchAll(/import\s*(?:\{([^}]*)\}\s*from\s*)?['"]([^'"]+)['"]/g)) {
    checks++;
    const spec = m[2];
    if (!spec.startsWith('.')) { fail(`${rel(f)} import "${spec}" không phải đường dẫn tương đối (giao diện không dùng thư viện ngoài)`); continue; }
    const target = path.resolve(path.dirname(f), spec);
    if (!fs.existsSync(target)) { fail(`${rel(f)} import file không tồn tại: ${spec}`); continue; }
    if (!m[1]) continue;
    const have = exportsOf(read(target));
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0];
      if (name && !have.has(name)) fail(`${rel(f)} import { ${name} } nhưng ${spec} không export tên này`);
    }
  }
}

// ───────── 3. index.html ─────────
const htmlPath = path.join(ROOT, 'public', 'index.html');
const html = read(htmlPath);
for (const m of html.matchAll(/\b(?:src|href)="(\/[^"#?]*)"/g)) {
  checks++;
  const p = m[1] === '/' ? '/index.html' : m[1];
  if (!fs.existsSync(path.join(ROOT, 'public', p))) fail(`index.html tham chiếu tài nguyên không tồn tại: ${m[1]}`);
}
checks++;
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!/\bsrc=/.test(m[1]) || m[2].trim()) fail('index.html có <script> nội tuyến — CSP (script-src \'self\') sẽ chặn nó');
}
checks++;
if (/\son[a-z]+\s*=\s*["']/i.test(html)) fail('index.html có thuộc tính sự kiện nội tuyến (onclick=…) — CSP sẽ chặn');

const clientSrc = clientFiles.map(read).join('\n');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const templateIds = new Set([...clientSrc.matchAll(/\bid="([A-Za-z][\w-]*)"/g)].map((m) => m[1]));
const usedIds = new Set([
  ...[...clientSrc.matchAll(/\$\$?\(\s*'#([A-Za-z][\w-]*)/g)].map((m) => m[1]),
  ...[...clientSrc.matchAll(/getElementById\(\s*'([A-Za-z][\w-]*)'/g)].map((m) => m[1]),
]);
for (const id of usedIds) {
  checks++;
  if (!htmlIds.has(id) && !templateIds.has(id)) fail(`JS dùng #${id} nhưng không có phần tử nào mang id này`);
}
const symbols = new Set([...html.matchAll(/<symbol id="i-([\w-]+)"/g)].map((m) => m[1]));
const usedIcons = new Set([
  ...[...clientSrc.matchAll(/\bicon\(\s*'([\w-]+)'/g)].map((m) => m[1]),
  ...[...(clientSrc + html).matchAll(/#i-([\w-]+)/g)].map((m) => m[1]),
]);
for (const name of usedIcons) {
  checks++;
  if (!symbols.has(name)) fail(`Biểu tượng "i-${name}" được dùng nhưng không có trong sprite của index.html`);
}

// ───────── 4. Máy chủ & dữ liệu ─────────
for (const f of walk(path.join(ROOT, 'server'), (p) => p.endsWith('.js'))) {
  checks++;
  try { require(f); } catch (e) { fail(`Không nạp được ${rel(f)}: ${e.message}`); }
}
try {
  const { WORDS, BANK } = require(path.join(ROOT, 'server', 'words.js'));
  const seen = new Map();
  for (const w of WORDS) {
    checks++;
    const k = w.w.normalize('NFC').toLocaleLowerCase('vi');
    if (seen.has(k)) fail(`Từ bị trùng trong ngân hàng: "${w.w}" (${seen.get(k)} và ${w.t})`);
    seen.set(k, w.t);
    if (!/^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u.test(w.w)) fail(`Từ không hợp lệ: "${w.w}"`);
  }
  checks++;
  if (Object.keys(BANK).length < 12) fail('Ngân hàng từ cần ít nhất 12 chủ đề');
} catch (e) { fail(`Không đọc được ngân hàng từ: ${e.message}`); }

const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
checks++;
if (pkg.dependencies && Object.keys(pkg.dependencies).length) fail('Dự án cam kết không dùng thư viện ngoài nhưng package.json có dependencies');

// ───────── Kết quả ─────────
if (problems.length) {
  console.error(`\n✖ Kiểm tra thất bại: ${problems.length} lỗi (trên ${checks} mục kiểm tra)\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error('');
  process.exit(1);
}
console.log(`✔ Build OK: ${checks} mục kiểm tra — ${serverFiles.length} file máy chủ/test, ${clientFiles.length} module giao diện, `
  + `${usedIds.size} id, ${usedIcons.size} biểu tượng. Không cần đóng gói: chạy "npm start".`);
