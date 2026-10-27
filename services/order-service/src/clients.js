const { loadProto, grpc, AppError, BadRequest, NotFound, Conflict } = require('@ecommerce/common');
const config = require('./config');

const creds = grpc.credentials.createInsecure();
const clients = {
  customer: new (loadProto('customer.proto').CustomerService)(config.customerAddr, creds),
  product: new (loadProto('product.proto').ProductService)(config.productAddr, creds),
};

function call(client, method, request, timeoutMs = config.grpcTimeoutMs) {
  return new Promise((resolve, reject) => {
    client[method](request, { deadline: Date.now() + timeoutMs }, (err, res) =>
      err ? reject(err) : resolve(res)
    );
  });
}

// Lỗi từ service khác -> lỗi nghiệp vụ của Order Service (giữ nguyên ý nghĩa 400/404/409)
function fromDownstream(err) {
  switch (err.code) {
    case grpc.status.NOT_FOUND: return NotFound(err.details);
    case grpc.status.ALREADY_EXISTS: return Conflict(err.details);          // không đủ hàng
    case grpc.status.INVALID_ARGUMENT: return BadRequest(err.details);
    case grpc.status.DEADLINE_EXCEEDED: return new AppError(504, 'Downstream service timed out');
    case grpc.status.UNAVAILABLE: return new AppError(503, 'Downstream service unavailable');
    default: return err; // lỗi lạ -> INTERNAL, không lộ chi tiết
  }
}

module.exports = { clients, call, fromDownstream, grpc };
