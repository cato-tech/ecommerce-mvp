const e = process.env;
const n = (v, d) => (v === undefined || v === '' ? d : Number(v));

module.exports = {
  port: n(e.GATEWAY_PORT, 18080),
  redisUrl: e.REDIS_URL || 'redis://localhost:16379',
  services: {
    auth: e.AUTH_ADDR || 'localhost:50051',
    customer: e.CUSTOMER_ADDR || 'localhost:50052',
    product: e.PRODUCT_ADDR || 'localhost:50053',
    order: e.ORDER_ADDR || 'localhost:50054',
    shipment: e.SHIPMENT_ADDR || 'localhost:50055',
  },
  // Giới hạn theo IP, cửa sổ 60 giây. Đăng nhập/đăng ký chặt hơn để chống dò mật khẩu.
  rate: {
    general: { limit: n(e.RATE_LIMIT_GENERAL, 120), windowSec: 60 },
    login: { limit: n(e.RATE_LIMIT_LOGIN, 10), windowSec: 60 },
    register: { limit: n(e.RATE_LIMIT_REGISTER, 10), windowSec: 60 },
  },
  tokenCacheTtlSec: 60,   // tối đa; luôn bị chặn bởi thời điểm token hết hạn
  productCacheTtlSec: 10,
  grpcTimeoutMs: 5000,
  orderTimeoutMs: 10000,
};
