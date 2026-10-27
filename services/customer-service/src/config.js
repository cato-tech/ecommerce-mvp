const e = process.env;

module.exports = {
  grpcPort: Number(e.CUSTOMER_GRPC_PORT || 50052),
  dbUrl:
    e.CUSTOMER_DB_URL ||
    `postgres://${e.POSTGRES_USER || 'app'}:${e.POSTGRES_PASSWORD || 'app_password'}` +
      `@${e.CUSTOMER_DB_HOST || 'localhost'}:${e.CUSTOMER_DB_PORT || 15434}/${e.CUSTOMER_DB || 'customer_db'}`,
};
