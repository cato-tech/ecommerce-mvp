const {
  loadProto, grpc, createLogger, describeError, createKafka, ensureTopics, retryUntilSuccess, startOutboxPublisher,
} = require('@ecommerce/common');
const config = require('./config');
const { migrate, pool } = require('./db');
const handlers = require('./handlers');

const log = createLogger('order-service');

async function main() {
  await migrate();

  const proto = loadProto('order.proto');
  const server = new grpc.Server();
  server.addService(proto.OrderService.service, {
    CreateOrder: handlers.CreateOrder,
    ListOrders: handlers.ListOrders,
    GetOrder: handlers.GetOrder,
  });

  server.bindAsync(`0.0.0.0:${config.grpcPort}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) throw err;
    log.info('order-service listening', { port });
  });

  // Kafka chạy nền; nếu Kafka chưa sẵn sàng, đơn vẫn được lưu và sự kiện chờ trong Outbox
  const kafka = createKafka('order-service');
  retryUntilSuccess('ensure topics', () => ensureTopics(kafka, ['order-created']), log);
  const stopOutbox = startOutboxPublisher({ pool, kafka, log });

  const stop = () => server.tryShutdown(async () => {
    await stopOutbox();
    await pool.end();
    process.exit(0);
  });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  log.error('startup failed', { error: describeError(err) });
  process.exit(1);
});
