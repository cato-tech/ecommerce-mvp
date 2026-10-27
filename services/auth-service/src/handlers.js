const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { BadRequest, Unauthorized, Conflict, toGrpcError, enqueue } = require('@ecommerce/common');
const config = require('./config');
const { pool } = require('./db');
const { validateRegister } = require('./validate');

// Hash giả để vẫn tốn thời gian so sánh khi username không tồn tại
// (tránh lộ "username có tồn tại hay không" qua thời gian phản hồi)
const DUMMY_HASH = bcrypt.hashSync('dummy-password', config.bcryptRounds);

// emitEvent = true: ghi sự kiện UserRegistered vào Outbox cùng transaction với việc tạo User
async function createUser({ username, password, email, phone }, rolename, emitEvent = false) {
  const hash = await bcrypt.hash(password, config.bcryptRounds);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO users (username, password, email, phone, roleid)
       VALUES ($1, $2, $3, $4, (SELECT roleid FROM roles WHERE rolename = $5))
       RETURNING uid`,
      [username, hash, email.toLowerCase(), phone || null, rolename]
    );
    const uid = rows[0].uid;
    if (emitEvent) {
      await enqueue(client, {
        topic: 'user-registered',
        key: uid,
        payload: {
          eventId: crypto.randomUUID(),
          uid,
          username,
          email: email.toLowerCase(),
          occurredAt: new Date().toISOString(),
        },
      });
    }
    await client.query('COMMIT');
    return uid;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') throw Conflict('Username or email already exists');
    throw err;
  } finally {
    client.release();
  }
}

// Tạo tài khoản mẫu khi khởi động (bỏ qua nếu đã có)
async function seedUsers() {
  for (const u of config.seedUsers) {
    const { rowCount } = await pool.query('SELECT 1 FROM users WHERE username = $1', [u.username]);
    if (!rowCount) await createUser(u, u.role);
  }
}

// Bọc handler: bắt lỗi và đổi sang mã gRPC
const wrap = (fn) => async (call, callback) => {
  try {
    callback(null, await fn(call.request));
  } catch (err) {
    callback(toGrpcError(err));
  }
};

const Register = wrap(async (req) => {
  validateRegister(req);
  const uid = await createUser(req, 'CUSTOMER', true); // đăng ký công khai luôn là CUSTOMER
  return { uid };
});

const Login = wrap(async ({ username, password }) => {
  if (!username || !password) throw BadRequest('username and password are required');

  const { rows } = await pool.query(
    `SELECT u.uid, u.password, r.rolename
       FROM users u JOIN roles r ON r.roleid = u.roleid
      WHERE u.username = $1`,
    [username]
  );
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
  if (!user || !ok) throw Unauthorized('Invalid username or password');

  const token = jwt.sign({ sub: String(user.uid), role: user.rolename }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
  return { access_token: token, expires_in: config.jwtExpiresIn };
});

const VerifyToken = wrap(async ({ token }) => {
  if (!token) throw Unauthorized('Missing token');
  try {
    const p = jwt.verify(token, config.jwtSecret);
    return { uid: Number(p.sub), role: p.role };
  } catch {
    throw Unauthorized('Invalid or expired token');
  }
});

module.exports = { Register, Login, VerifyToken, seedUsers };
