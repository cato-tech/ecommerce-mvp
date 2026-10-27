const { createLogger } = require('@ecommerce/common');
const config = require('./config');
const app = require('./app');
const redis = require('./redis');

const log = createLogger('api-gateway');

const server = app.listen(config.port, () => log.info('api-gateway listening', { port: config.port }));

const stop = () => server.close(() => { redis.quit().catch(() => {}); process.exit(0); });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
