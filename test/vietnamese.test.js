'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../server/vietnamese');

const judge = (guess, answers, mode = 'loose') => V.judgeGuess(guess, [].concat(answers), mode).result;

test('chuẩn hoá: hoa/thường, khoảng trắng, dấu câu, đ → d', () => {
  assert.equal(V.clean('  BÁNH   Mì!!! '), 'bánh mì');
  assert.equal(V.looseKey('  BÁNH   Mì!!! '), 'banh mi');
  assert.equal(V.looseKey('Đường'), 'duong');
});

test('bỏ dấu kiểu cũ và kiểu mới, dạng tổ hợp NFD đều coi là một', () => {
  assert.equal(V.strictKey('hoà'), V.strictKey('hòa'));
  assert.equal(V.strictKey('thuý'), V.strictKey('thúy'));
  assert.equal(V.strictKey('bánh mì'.normalize('NFD')), V.strictKey('bánh mì'));
  assert.equal(judge('hoà bình', 'Hòa bình', 'strict'), 'correct');
});

test('chế độ không bắt buộc dấu: có dấu, không dấu, viết liền, hoa thường đều đúng', () => {
  for (const g of ['bánh mì', 'banh mi', 'BANH MI', 'bánh mì.', 'banhmi', 'bánhmì', 'banh mì', 'Bánh  mì'])
    assert.equal(judge(g, 'Bánh mì'), 'correct', g);
});

test('không dấu thì so không dấu, nhưng gõ có dấu SAI thì không được tính đúng', () => {
  assert.equal(judge('bo', 'Bơ'), 'correct');
  assert.equal(judge('bò', 'Bơ'), 'accent', '"bò" ≠ "bơ" dù cùng mặt chữ');
  assert.equal(judge('bơ', 'Bơ'), 'correct');
  assert.equal(judge('bánh mỳ', 'Bánh mì'), 'close');
  assert.equal(judge('bành mì', 'Bánh mì'), 'accent');
});

test('chế độ bắt buộc dấu: thiếu/sai dấu → "accent", đúng dấu → đúng', () => {
  assert.equal(judge('banh mi', 'Bánh mì', 'strict'), 'accent');
  assert.equal(judge('bánh mi', 'Bánh mì', 'strict'), 'accent');
  assert.equal(judge('Bánh Mì', 'Bánh mì', 'strict'), 'correct');
  assert.equal(judge('bánhmì', 'Bánh mì', 'strict'), 'correct');
});

test('lượng từ đầu (con, cái, quả…) được thêm hoặc bớt', () => {
  assert.equal(judge('mèo', 'Con mèo'), 'correct');
  assert.equal(judge('con meo', 'Mèo'), 'correct');
  assert.equal(judge('chuoi', 'Quả chuối'), 'correct');
  assert.equal(judge('cá', 'Con cá'), 'correct');
  // phần còn lại quá ngắn thì không bỏ lượng từ để tránh đoán bừa 1 chữ cái
  assert.equal(judge('o', 'Cái ô'), 'wrong');
  // "bộ" không phải lượng từ: "đội" không được tính là "bộ đội"
  assert.equal(judge('đội', 'Bộ đội'), 'wrong');
});

test('cách viết khác (alias) được chấp nhận', () => {
  assert.equal(judge('chả giò', ['Nem rán', 'chả giò']), 'correct');
  assert.equal(judge('xe hoi', ['Ô tô', 'xe hơi']), 'correct');
});

test('đoán gần đúng dùng Levenshtein, từ quá ngắn không gợi ý', () => {
  assert.equal(V.levenshtein('kitten', 'sitting'), 3);
  assert.equal(V.levenshtein('abc', 'xyz', 1), 2, 'ngắt sớm trả về max+1');
  assert.equal(judge('nui lux', 'Núi lửa'), 'close');
  assert.equal(judge('ca fe trung', 'Cà phê trứng'), 'close');
  assert.equal(judge('ca phe trung', 'Cà phê trứng'), 'correct');
  assert.equal(judge('mè', 'Mèo'), 'wrong', 'từ ≤ 3 chữ cái không báo gần đúng (tránh lộ)');
  assert.equal(judge('xe đạp', 'Bánh mì'), 'wrong');
});

test('tin nhắn chứa đáp án bị coi là "contains" (để ẩn đi, chống lộ từ)', () => {
  assert.equal(judge('chắc là bánh mì rồi', 'Bánh mì'), 'contains');
  assert.equal(judge('toi doan la banhmi', 'Bánh mì'), 'contains');
  assert.equal(judge('xe dap dien', 'Xe đạp'), 'contains');
  // không ẩn nhầm: đáp án ngắn nằm lọt trong chữ khác
  assert.equal(judge('cam on nha', 'Cá'), 'wrong');
  assert.equal(judge('ok luôn', 'Ô tô'), 'wrong');
});

test('chuỗi rỗng, chỉ dấu câu, emoji → sai, không lỗi', () => {
  for (const g of ['', '   ', '!!!', '😀😀', '\u0000\u0007'])
    assert.equal(judge(g, 'Bánh mì'), 'wrong', JSON.stringify(g));
});

test('mặt nạ, gợi ý và thông tin độ dài', () => {
  assert.deepEqual(V.makeMask('Bánh mì'), ['_', '_', '_', '_', ' ', '_', '_']);
  assert.deepEqual(V.makeMask('Bánh mì', new Set([1])), ['_', 'á', '_', '_', ' ', '_', '_']);
  assert.deepEqual(V.makeMask('Tic-tac'), ['_', '_', '_', '-', '_', '_', '_']);
  assert.deepEqual(V.lengthInfo('Mèo mù vớ cá rán'), { syllables: 5, letters: [3, 2, 2, 2, 3] });
  assert.deepEqual(V.letterIndexes('Bánh mì'), [0, 1, 2, 3, 5, 6]);
  // NFD đầu vào vẫn cho cùng mặt nạ
  assert.equal(V.makeMask('Bánh mì'.normalize('NFD')).length, 7);
});
