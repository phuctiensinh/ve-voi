// Xử lý chuỗi tiếng Việt: chuẩn hoá, so khớp đáp án, khoảng cách Levenshtein, mặt nạ từ.
'use strict';

// Dấu thanh (tổ hợp Unicode): sắc, huyền, hỏi, ngã, nặng
const TONE_MARKS = { '́': 1, '̀': 2, '̉': 3, '̃': 4, '̣': 5 };
const TONE_RE = /[̣̀́̃̉]/g;

// Lượng từ đứng đầu thường bị người chơi gõ thêm/bớt: "con mèo" = "mèo", "quả táo" = "táo"
const CLASSIFIERS = new Set(['con', 'cái', 'chiếc', 'quả', 'trái', 'cây', 'bông', 'tờ', 'cuốn', 'quyển', 'đôi', 'ngôi', 'toà', 'tòa', 'củ', 'hòn', 'viên', 'cục', 'tấm']);

/** Làm sạch: NFC, chữ thường, bỏ ký tự điều khiển & dấu câu, gộp khoảng trắng. */
function clean(input) {
  return String(input ?? '')
    .normalize('NFC')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Khoá "có dấu" của một âm tiết: tách dấu thanh ra cuối để "hoà"/"hòa", "thuý"/"thúy" trùng nhau. */
function strictSyllable(syl) {
  let tone = 0;
  const base = syl.normalize('NFD').replace(TONE_RE, (m) => { tone = TONE_MARKS[m]; return ''; }).normalize('NFC');
  return tone ? base + tone : base;
}
const strictKey = (input) => clean(input).split(' ').map(strictSyllable).join(' ');

/** Khoá "không dấu": bỏ dấu thanh, dấu mũ/móc/trăng, đ → d. */
function looseKey(input) {
  return clean(input).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').normalize('NFC');
}

const squash = (s) => s.replace(/\s+/g, '');

/** Khoá "có dấu" bỏ khoảng trắng: chữ (giữ mũ/móc/trăng) + chuỗi dấu thanh theo thứ tự — "bánhmì" = "bánh mì". */
function strictFlat(input) {
  const tones = [];
  const base = squash(clean(input)).normalize('NFD').replace(TONE_RE, (m) => { tones.push(TONE_MARKS[m]); return ''; }).normalize('NFC');
  return `${base}#${tones.join('')}`;
}
/** Chuỗi có ký tự mang dấu tiếng Việt (kể cả đ) hay không. */
const hasMarks = (s) => looseKey(s) !== clean(s);

/** Levenshtein có ngắt sớm khi vượt ngưỡng `max` (trả về max+1). */
function levenshtein(a, b, max = Infinity) {
  if (a === b) return 0;
  const A = [...a], B = [...b];
  if (Math.abs(A.length - B.length) > max) return max + 1;
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= B.length; j++) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[B.length];
}

/** Ngưỡng "đoán gần đúng" theo số chữ cái của đáp án. Từ ngắn không gợi ý để tránh lộ. */
function closeThreshold(answerLoose) {
  const n = [...squash(answerLoose)].length;
  if (n <= 3) return 0;
  if (n <= 6) return 1;
  return 2;
}

/** Các biến thể chấp nhận của một cụm: nguyên bản + bỏ lượng từ đầu (nếu phần còn lại đủ dài). */
function variants(text) {
  const c = clean(text);
  const out = [c];
  const words = c.split(' ');
  if (words.length > 1 && CLASSIFIERS.has(words[0])) {
    const rest = words.slice(1).join(' ');
    if ([...squash(looseKey(rest))].length >= 2) out.push(rest);
  }
  return out;
}

/**
 * Hai cụm có khớp không.
 * - strict: phải đúng dấu.
 * - loose: âm tiết nào người chơi GÕ CÓ DẤU thì so có dấu, âm tiết gõ không dấu thì so không dấu.
 *   Nhờ vậy "banh mi", "bánh mì", "banh mì" đều đúng cho "bánh mì", nhưng "bò" không được tính là "bơ".
 */
function phraseMatch(guess, answer, mode) {
  if (mode === 'strict') return strictFlat(guess) === strictFlat(answer);
  if (!hasMarks(guess)) return squash(looseKey(guess)) === squash(looseKey(answer));
  const g = guess.split(' '), a = answer.split(' ');
  if (g.length !== a.length) return strictFlat(guess) === strictFlat(answer);
  return g.every((tok, i) => (hasMarks(tok) ? strictSyllable(tok) === strictSyllable(a[i]) : looseKey(tok) === looseKey(a[i])));
}

/**
 * Chấm một lượt đoán.
 * @param {string} guess    người chơi gõ
 * @param {string[]} answers từ khoá + các cách viết được chấp nhận
 * @param {'loose'|'strict'} mode
 * @returns {{result: 'correct'|'accent'|'contains'|'close'|'wrong'}}
 *   accent   = đúng chữ cái nhưng sai/thiếu dấu
 *   contains = câu chat có chứa đáp án (cần ẩn để không lộ)
 *   close    = sai 1–2 ký tự
 */
function judgeGuess(guess, answers, mode = 'loose') {
  const gClean = clean(guess);
  if (!looseKey(gClean)) return { result: 'wrong' };
  const rank = { wrong: 0, close: 1, contains: 2, accent: 3 };
  let best = 'wrong';
  const bump = (r) => { if (rank[r] > rank[best]) best = r; };

  for (const ans of answers) {
    const aClean = clean(ans);
    if (!looseKey(aClean)) continue;
    const gv = variants(gClean), av = variants(aClean);
    for (const g of gv) for (const a of av) if (phraseMatch(g, a, mode)) return { result: 'correct' };
    for (const g of gv) for (const a of av) if (squash(looseKey(g)) === squash(looseKey(a))) bump('accent');
    const gL = looseKey(gClean), aL = looseKey(aClean);
    if (gL.length > aL.length && (` ${gL} `).includes(` ${aL} `)) { bump('contains'); continue; }
    // Viết liền đáp án trong câu ("toi doan la banhmi"): vẫn ẩn, nhưng chỉ với đáp án đủ dài để tránh ẩn nhầm
    if (av.some((a) => { const k = squash(looseKey(a)); return [...k].length >= 4 && squash(gL).length > k.length && squash(gL).includes(k); })) { bump('contains'); continue; }
    const t = closeThreshold(aL);
    if (t > 0 && av.some((a) => levenshtein(squash(gL), squash(looseKey(a)), t) <= t)) bump('close');
  }
  return { result: best };
}

/** Vị trí các ký tự là chữ/số trong từ (dùng cho mặt nạ & gợi ý). */
function letterIndexes(word) {
  return [...word.normalize('NFC')].map((c, i) => (/[\p{L}\p{N}]/u.test(c) ? i : -1)).filter((i) => i >= 0);
}

/** Mặt nạ hiển thị từ bí mật: chữ → "_", giữ khoảng trắng & dấu gạch; chữ đã gợi ý thì hiện. */
function makeMask(word, revealed = new Set()) {
  return [...word.normalize('NFC')].map((ch, i) => {
    if (/\s/.test(ch)) return ' ';
    if (!/[\p{L}\p{N}]/u.test(ch)) return ch;
    return revealed.has(i) ? ch : '_';
  });
}

/** Thông tin độ dài: số tiếng và số chữ mỗi tiếng — "bánh mì" → { syllables: 2, letters: [4, 2] }. */
function lengthInfo(word) {
  const parts = clean(word).split(' ').filter(Boolean);
  return { syllables: parts.length, letters: parts.map((p) => [...p].length) };
}

module.exports = { clean, strictKey, strictFlat, looseKey, hasMarks, levenshtein, judgeGuess, makeMask, lengthInfo, letterIndexes, closeThreshold, variants };
