const Redis = require('ioredis');
const config = require('./config');
const { createLogger } = require('@ecommerce/common');

const log = createLogger('api-gateway');
let lastWarn = 0;

// enableOfflineQueue = false: khi Redis chết, lệnh lỗi ngay (không treo request)
const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on('error', (err) => {
  if (Date.now() - lastWarn > 10000) {
    lastWarn = Date.now();
    log.warn('redis error', { error: err.message });
  }
});

module.exports = redis;
