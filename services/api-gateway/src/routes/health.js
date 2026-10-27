const express = require('express');
const redis = require('../redis');
const { clients } = require('../grpc');
const { ah } = require('../middleware');

const router = express.Router();

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// Kênh gRPC sẵn sàng trong 700ms => UP
const grpcUp = (client) =>
  new Promise((resolve) => client.waitForReady(Date.now() + 700, (err) => resolve(!err)));

// API-HEALTH-01
router.get('/', ah(async (req, res) => {
  const names = Object.keys(clients);
  const [redisOk, ...svc] = await Promise.all([
    withTimeout(redis.ping(), 700).then(() => true, () => false),
    ...names.map((n) => grpcUp(clients[n])),
  ]);
  const dependencies = { redis: redisOk ? 'UP' : 'DOWN' };
  names.forEach((n, i) => { dependencies[`${n}-service`] = svc[i] ? 'UP' : 'DOWN'; });

  const allUp = Object.values(dependencies).every((v) => v === 'UP');
  res.status(allUp ? 200 : 503).json({
    status: allUp ? 'UP' : 'DEGRADED',
    message: allUp ? 'E-commerce API is running' : 'Some required dependencies are unavailable',
    dependencies,
  });
}));

module.exports = router;
