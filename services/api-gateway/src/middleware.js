const crypto = require('crypto');
const { Unauthorized, Forbidden, createLogger, AppError } = require('@ecommerce/common');
const config = require('./config');
const redis = require('./redis');
const { clients, call, toHttpError } = require('./grpc');

const log = createLogger('api-gateway');

// ---- Logging: mỗi request một dòng JSON, KHÔNG ghi body/mật khẩu/token ----
function requestLogger(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    log.info('request', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Number(process.hrtime.bigint() - start) / 1e6,
      uid: req.user?.uid,
      ip: req.ip,
    });
  });
  next();
}

// ---- Rate limiting bằng Redis (cửa sổ cố định, đếm nguyên tử bằng Lua) ----
const RATE_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('TTL', KEYS[1])}
`;

function rateLimit(name, { limit, windowSec }) {
  return async (req, res, next) => {
    try {
      const [count, ttl] = await redis.eval(RATE_LUA, 1, `rl:${name}:${req.ip}`, windowSec);
      res.set('X-RateLimit-Limit', String(limit));
      res.set('X-RateLimit-Remaining', String(Math.max(0, limit - count)));
      if (count > limit) {
        res.set('Retry-After', String(Math.max(1, ttl)));
        return res.status(429).json({ status: 429, message: 'Too many requests, please retry later' });
      }
    } catch (err) {
      // Redis lỗi: cho qua (fail-open) để hệ thống không ngừng chỉ vì Redis
      log.warn('rate limit skipped', { error: err.message });
    }
    next();
  };
}

// ---- Xác thực JWT: hỏi Auth Service, cache kết quả trong Redis ----
function secondsUntilExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return Math.floor(payload.exp - Date.now() / 1000);
  } catch {
    return 0;
  }
}

async function verifyToken(token) {
  const key = 'tok:' + crypto.createHash('sha256').update(token).digest('hex');
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit);
  } catch { /* Redis lỗi: hỏi thẳng Auth Service */ }

  const r = await call(clients.auth, 'VerifyToken', { token });
  const user = { uid: r.uid, role: r.role };
  // Không bao giờ cache lâu hơn thời điểm token hết hạn
  const ttl = Math.min(config.tokenCacheTtlSec, secondsUntilExpiry(token));
  if (ttl > 0) redis.set(key, JSON.stringify(user), 'EX', ttl).catch(() => {});
  return user;
}

async function authenticate(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (!m) return next(Unauthorized('Missing or malformed Authorization header'));
  try {
    req.user = await verifyToken(m[1]);
    next();
  } catch (err) {
    // Auth Service báo token sai/hết hạn -> 401; lỗi hạ tầng -> 503/504 (xử lý ở errorHandler)
    next(err);
  }
}

const authorize = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(Forbidden('Insufficient role'));

// ---- Xử lý lỗi tập trung ----
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ status: 400, message: 'Invalid JSON body' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ status: 413, message: 'Request body too large' });
  }
  const { status, message } = toHttpError(err);
  if (status >= 500) log.error('request failed', { requestId: req.id, error: err.message || String(err) });
  // Token sai: Auth Service trả UNAUTHENTICATED -> 401 (đã được ánh xạ trong toHttpError)
  res.status(status).json({ status, message });
}

const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

module.exports = { requestLogger, rateLimit, authenticate, authorize, errorHandler, ah, AppError };
