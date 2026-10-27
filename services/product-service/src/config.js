const e = process.env;

module.exports = {
  grpcPort: Number(e.PRODUCT_GRPC_PORT || 50053),
  // Chạy trên máy: localhost:37018 (cổng host của container product-db)
  mongoUrl: e.PRODUCT_DB_URL || `mongodb://${e.PRODUCT_DB_HOST || 'localhost'}:${e.PRODUCT_DB_PORT || 37018}`,
  dbName: e.MONGO_PRODUCT_DB || 'product_db',
  seedProducts: e.SEED_PRODUCTS !== 'false',
};
