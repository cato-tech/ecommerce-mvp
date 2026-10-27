const grpc = require('@grpc/grpc-js');

// Bảng ánh xạ: mã HTTP <-> mã gRPC
const MAP = [
  { http: 400, grpc: grpc.status.INVALID_ARGUMENT },
  { http: 401, grpc: grpc.status.UNAUTHENTICATED },
  { http: 403, grpc: grpc.status.PERMISSION_DENIED },
  { http: 404, grpc: grpc.status.NOT_FOUND },
  { http: 409, grpc: grpc.status.ALREADY_EXISTS },
  { http: 500, grpc: grpc.status.INTERNAL },
  { http: 503, grpc: grpc.status.UNAVAILABLE },
  { http: 504, grpc: grpc.status.DEADLINE_EXCEEDED },
  { http: 429, grpc: grpc.status.RESOURCE_EXHAUSTED },
];

class AppError extends Error {
  constructor(httpStatus, message) {
    super(message);
    this.httpStatus = httpStatus;
  }
  toGrpc() {
    const m = MAP.find((x) => x.http === this.httpStatus) || MAP[5];
    return { code: m.grpc, message: this.message };
  }
}

// Dùng trong handler gRPC: callback(toGrpcError(err))
function toGrpcError(err) {
  if (err instanceof AppError) return err.toGrpc();
  console.error(err);
  return { code: grpc.status.INTERNAL, message: 'Internal error' };
}

// Dùng ở Gateway: lỗi gRPC -> mã HTTP
function grpcToHttp(err) {
  const m = MAP.find((x) => x.grpc === err.code);
  return m ? m.http : 500;
}

// Mô tả lỗi đầy đủ: lỗi kết nối localhost (IPv6 + IPv4) là AggregateError có message rỗng
function describeError(err) {
  if (!err) return 'unknown error';
  if (Array.isArray(err.errors) && err.errors.length) {
    return err.errors.map((e) => e.message || `${e.code || 'ERR'} ${e.address || ''}:${e.port || ''}`).join('; ');
  }
  return err.message || err.code || String(err);
}

module.exports = {
  describeError,
  AppError,
  toGrpcError,
  grpcToHttp,
  BadRequest: (msg) => new AppError(400, msg),
  Unauthorized: (msg) => new AppError(401, msg),
  Forbidden: (msg) => new AppError(403, msg),
  NotFound: (msg) => new AppError(404, msg),
  Conflict: (msg) => new AppError(409, msg),
};
