const e = process.env;

module.exports = {
  grpcPort: Number(e.SHIPMENT_GRPC_PORT || 50055),
  // Chạy trên máy: localhost:37019 (cổng host của container shipment-db)
  mongoUrl: e.SHIPMENT_DB_URL || `mongodb://${e.SHIPMENT_DB_HOST || 'localhost'}:${e.SHIPMENT_DB_PORT || 37019}`,
  dbName: e.MONGO_SHIPMENT_DB || 'shipment_db',
  firstShipid: 5001, // khớp ví dụ trong API Spec
};
