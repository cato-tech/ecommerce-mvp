const e = process.env;

module.exports = {
  grpcPort: Number(e.ORDER_GRPC_PORT || 50054),
  dbUrl:
    e.ORDER_DB_URL ||
    `postgres://${e.POSTGRES_USER || 'app'}:${e.POSTGRES_PASSWORD || 'app_password'}` +
      `@${e.ORDER_DB_HOST || 'localhost'}:${e.ORDER_DB_PORT || 15435}/${e.ORDER_DB || 'order_db'}`,
  customerAddr: e.CUSTOMER_ADDR || 'localhost:50052',
  productAddr: e.PRODUCT_ADDR || 'localhost:50053',
  grpcTimeoutMs: 5000,
  listLimit: 100,
};
