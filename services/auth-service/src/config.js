const e = process.env;

module.exports = {
  grpcPort: Number(e.AUTH_GRPC_PORT || 50051),
  // Chạy trên máy: localhost:15433. Trong Docker (Bước 10) sẽ đặt AUTH_DB_URL.
  dbUrl:
    e.AUTH_DB_URL ||
    `postgres://${e.POSTGRES_USER || 'app'}:${e.POSTGRES_PASSWORD || 'app_password'}` +
      `@${e.AUTH_DB_HOST || 'localhost'}:${e.AUTH_DB_PORT || 15433}/${e.AUTH_DB || 'auth_db'}`,
  jwtSecret: e.JWT_SECRET,
  jwtExpiresIn: 3600, // giây, khớp "expiresIn": 3600 trong API Spec
  bcryptRounds: 10,
  // Tài khoản mẫu cho môi trường dev (Admin và Shipment Staff không tự đăng ký được)
  seedUsers: [
    { username: e.ADMIN_USERNAME || 'admin', password: e.ADMIN_PASSWORD || 'Admin@123', email: 'admin@example.com', role: 'ADMIN' },
    { username: e.STAFF_USERNAME || 'shipper', password: e.STAFF_PASSWORD || 'Shipper@123', email: 'shipper@example.com', role: 'SHIPMENT_STAFF' },
  ],
};
