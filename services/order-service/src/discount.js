// Chính sách giảm giá theo score của hạng thành viên (đơn vị: phần trăm)
// Bảng này khớp 3 hạng mẫu: BRONZE (0), SILVER (100), GOLD (500)
const TIERS = [
  { minScore: 500, percent: 10 },
  { minScore: 100, percent: 5 },
  { minScore: 0, percent: 0 },
];

function discountForScore(score) {
  const tier = TIERS.find((t) => score >= t.minScore);
  return tier ? tier.percent : 0;
}

module.exports = { discountForScore };
