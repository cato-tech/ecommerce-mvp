const {
  loadProto, grpc, createLogger, describeError, createKafka, ensureTopics, retryUntilSuccess, startConsumer,
} = require('@ecommerce/common');
const config = require('./config');
const db = require('./db');
const handlers = require('./handlers');

const log = createLogger('shipment-service');

async function main() {
  await db.connect();

  const proto = loadProto('shipment.proto');
  const server = new grpc.Server();
  server.addService(proto.ShipmentService.service, {
    GetShipment: handlers.GetShipment,
    GetShipmentByOrder: handlers.GetShipmentByOrder,
    UpdateShipmentStatus: handlers.UpdateShipmentStatus,
  });

  server.bindAsync(`0.0.0.0:${config.grpcPort}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) throw err;
    log.info('shipment-service listening', { port });
  });

  // Consumer chạy nền, tự thử lại nếu Kafka chưa sẵn sàng
  const kafka = createKafka('shipment-service');
  let consumer;
  retryUntilSuccess('start consumer', async () => {
    await ensureTopics(kafka, ['order-created']);
    consumer = await startConsumer({
      kafka,
      groupId: 'shipment-service',
      topic: 'order-created',
      handler: handlers.onOrderCreated,
      log,
    });
    log.info('consumer started', { topic: 'order-created' });
  }, log);

  const stop = () => server.tryShutdown(async () => {
    if (consumer) await consumer.disconnect().catch(() => {});
    await db.close();
    process.exit(0);
  });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  log.error('startup failed', { error: describeError(err) });
  process.exit(1);
});
