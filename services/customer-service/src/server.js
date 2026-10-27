const {
  loadProto, grpc, createLogger, describeError, createKafka, ensureTopics, retryUntilSuccess, startConsumer,
} = require('@ecommerce/common');
const config = require('./config');
const { migrate, pool } = require('./db');
const handlers = require('./handlers');

const log = createLogger('customer-service');

async function main() {
  await migrate();

  const proto = loadProto('customer.proto');
  const server = new grpc.Server();
  server.addService(proto.CustomerService.service, {
    GetCustomer: handlers.GetCustomer,
    GetMembership: handlers.GetMembership,
    UpdateCustomer: handlers.UpdateCustomer,
  });

  server.bindAsync(`0.0.0.0:${config.grpcPort}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) throw err;
    log.info('customer-service listening', { port });
  });

  // Consumer chạy nền, tự thử lại nếu Kafka chưa sẵn sàng
  const kafka = createKafka('customer-service');
  let consumer;
  retryUntilSuccess('start consumer', async () => {
    await ensureTopics(kafka, ['user-registered']);
    consumer = await startConsumer({
      kafka,
      groupId: 'customer-service',
      topic: 'user-registered',
      handler: async (event) => {
        await handlers.onUserRegistered(event);
        log.info('customer created from UserRegistered', { uid: event.uid });
      },
      log,
    });
    log.info('consumer started', { topic: 'user-registered' });
  }, log);

  const stop = () => server.tryShutdown(async () => {
    if (consumer) await consumer.disconnect().catch(() => {});
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
