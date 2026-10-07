// Công thức tính điểm — tách riêng để dễ cân chỉnh và kiểm thử.
'use strict';

const DIFFICULTY = {
  easy:   { label: 'Dễ',         guessMax: 400, drawMax: 250 },
  medium: { label: 'Trung bình', guessMax: 450, drawMax: 300 },
  hard:   { label: 'Khó',        guessMax: 500, drawMax: 350 },
};

/**
 * Điểm người đoán: đoán càng nhanh càng cao, tối đa 500/lượt (từ Khó).
 * Sàn 20% để người đoán muộn vẫn có động lực.
 * Cộng thưởng thứ tự: người đầu tiên +10%, thứ hai +5% (không vượt trần).
 */
function guesserPoints({ difficulty, timeLeftMs, drawTimeMs, order }) {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  const ratio = Math.max(0, Math.min(1, timeLeftMs / drawTimeMs));
  let pts = cfg.guessMax * (0.2 + 0.8 * ratio);
  if (order === 0) pts *= 1.10;
  else if (order === 1) pts *= 1.05;
  return Math.min(cfg.guessMax, Math.round(pts / 5) * 5);
}

/** Điểm người vẽ: tỉ lệ thuận với số người đoán trúng. Không ai đoán ra → 0. */
function drawerPoints({ difficulty, correct, guessers }) {
  if (!guessers || !correct) return 0;
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  return Math.round((cfg.drawMax * correct / guessers) / 5) * 5;
}

/** Phạt người vẽ khi bị tố cáo "viết chữ lên bảng". */
const REPORT_PENALTY = 100;

module.exports = { DIFFICULTY, guesserPoints, drawerPoints, REPORT_PENALTY };
