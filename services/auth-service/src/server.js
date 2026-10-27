const {
  loadProto, grpc, createLogger, describeError, createKafka, ensureTopics, retryUntilSuccess, startOutboxPublisher,
} = require('@ecommerce/common');
const config = require('./config');
const { migrate, pool } = require('./db');
const handlers = require('./handlers');

const log = createLogger('auth-service');

async function main() {
  if (!config.jwtSecret || config.jwtSecret.length < 16) {
    throw new Error('JWT_SECRET is missing or too short (need >= 16 chars)');
  }
  await migrate();
  await handlers.seedUsers();

  const proto = loadProto('auth.proto');
  const server = new grpc.Server();
  server.addService(proto.AuthService.service, {
    Register: handlers.Register,
    Login: handlers.Login,
    VerifyToken: handlers.VerifyToken,
  });

  server.bindAsync(`0.0.0.0:${config.grpcPort}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) throw err;
    log.info('auth-service listening', { port });
  });

  // Kafka chạy nền: nếu Kafka chưa sẵn sàng, service vẫn phục vụ gRPC, sự kiện nằm chờ trong Outbox
  const kafka = createKafka('auth-service');
  retryUntilSuccess('ensure topics', () => ensureTopics(kafka, ['user-registered']), log);
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
