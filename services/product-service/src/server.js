const { loadProto, grpc, createLogger, describeError } = require('@ecommerce/common');
const config = require('./config');
const db = require('./db');
const handlers = require('./handlers');

const log = createLogger('product-service');

async function main() {
  await db.connect();
  if (config.seedProducts) await handlers.seed();

  const proto = loadProto('product.proto');
  const server = new grpc.Server();
  server.addService(proto.ProductService.service, {
    ListProducts: handlers.ListProducts,
    GetProduct: handlers.GetProduct,
    CreateProduct: handlers.CreateProduct,
    UpdateProduct: handlers.UpdateProduct,
    DeleteProduct: handlers.DeleteProduct,
    ReserveStock: handlers.ReserveStock,
    ReleaseStock: handlers.ReleaseStock,
  });

  server.bindAsync(`0.0.0.0:${config.grpcPort}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) throw err;
    log.info('product-service listening', { port });
  });

  const stop = () => server.tryShutdown(async () => { await db.close(); process.exit(0); });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  log.error('startup failed', { error: describeError(err) });
  process.exit(1);
});
