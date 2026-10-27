const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// Thư mục proto: mặc định ../../../proto (chạy local), hoặc /proto trong Docker
const PROTO_DIR = process.env.PROTO_DIR || path.resolve(__dirname, '../../../proto');

function loadProto(file) {
  const def = protoLoader.loadSync(path.join(PROTO_DIR, file), {
    keepCase: true, longs: Number, enums: String, defaults: true, oneofs: true,
  });
  return grpc.loadPackageDefinition(def).ecommerce;
}

module.exports = { loadProto, grpc };
