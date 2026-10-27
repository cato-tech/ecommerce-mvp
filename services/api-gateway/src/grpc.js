const { loadProto, grpc, AppError, grpcToHttp } = require('@ecommerce/common');
const config = require('./config');

const creds = grpc.credentials.createInsecure();
const make = (file, name, addr) => new (loadProto(file)[name])(addr, creds);

const clients = {
  auth: make('auth.proto', 'AuthService', config.services.auth),
  customer: make('customer.proto', 'CustomerService', config.services.customer),
  product: make('product.proto', 'ProductService', config.services.product),
  order: make('order.proto', 'OrderService', config.services.order),
  shipment: make('shipment.proto', 'ShipmentService', config.services.shipment),
};

// Gọi gRPC có deadline: service chậm hoặc chết không làm treo request
function call(client, method, request, timeoutMs = config.grpcTimeoutMs) {
  return new Promise((resolve, reject) => {
    client[method](request, { deadline: Date.now() + timeoutMs }, (err, res) =>
      err ? reject(err) : resolve(res)
    );
  });
}

// Lỗi gRPC -> { status, message } cho HTTP. Lỗi 5xx không lộ chi tiết nội bộ.
function toHttpError(err) {
  if (err instanceof AppError) return { status: err.httpStatus, message: err.message };
  if (typeof err.code === 'number') {
    const status = grpcToHttp(err);
    if (status === 503) return { status, message: 'Service temporarily unavailable' };
    if (status === 504) return { status, message: 'Service timed out' };
    if (status >= 500) return { status: 500, message: 'Internal error' };
    return { status, message: err.details || 'Request failed' };
  }
  return { status: 500, message: 'Internal error' };
}

module.exports = { clients, call, toHttpError };
