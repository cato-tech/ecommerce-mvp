const { BadRequest, Forbidden, NotFound, toGrpcError } = require('@ecommerce/common');
const { pool } = require('./db');

const wrap = (fn) => async (call, callback) => {
  try {
    callback(null, await fn(call.request));
  } catch (err) {
    callback(toGrpcError(err));
  }
};

async function findCustomer(uid) {
  const { rows } = await pool.query(
    'SELECT uid, fullname, mid FROM customers WHERE uid = $1',
    [uid]
  );
  return rows[0];
}

const GetCustomer = wrap(async ({ uid }) => {
  const customer = await findCustomer(uid);
  if (!customer) throw NotFound('Customer not found');
  return customer;
});

const GetMembership = wrap(async ({ uid }) => {
  const { rows } = await pool.query(
    `SELECT m.mid, m.mname, m.score
       FROM customers c JOIN memberships m ON m.mid = c.mid
      WHERE c.uid = $1`,
    [uid]
  );
  if (!rows[0]) throw NotFound('Customer not found');
  return rows[0];
});

const UpdateCustomer = wrap(async ({ uid, fullname, mid, caller_uid, caller_role }) => {
  const isAdmin = caller_role === 'ADMIN';

  // 1) Phân quyền trước: khách chỉ sửa được hồ sơ của chính mình
  if (!isAdmin && caller_uid !== uid) throw Forbidden('You can only update your own profile');

  // 2) Tồn tại?
  const current = await findCustomer(uid);
  if (!current) throw NotFound('Customer not found');

  // 3) Hạng thành viên: chỉ Admin được đổi (proto3: mid = 0 nghĩa là không gửi)
  if (mid && mid !== current.mid && !isAdmin) {
    throw Forbidden('Only admin can change membership');
  }

  const name = (fullname || '').trim();
  if (!name && !mid) throw BadRequest('fullname or mid is required');
  if (name.length > 100) throw BadRequest('fullname must be at most 100 characters');
  if (mid) {
    const { rowCount } = await pool.query('SELECT 1 FROM memberships WHERE mid = $1', [mid]);
    if (!rowCount) throw BadRequest('Invalid mid');
  }

  const { rows } = await pool.query(
    `UPDATE customers
        SET fullname = COALESCE($2, fullname), mid = COALESCE($3, mid), updated_at = now()
      WHERE uid = $1
  RETURNING uid, fullname, mid`,
    [uid, name || null, mid || null]
  );
  return rows[0];
});

// Xử lý sự kiện UserRegistered. Idempotent: nhận trùng sự kiện vẫn chỉ có một Customer.
async function onUserRegistered(event) {
  if (!Number.isInteger(event.uid) || event.uid <= 0 || !event.username) {
    throw new Error('Invalid UserRegistered event');
  }
  await pool.query(
    `INSERT INTO customers (uid, fullname, mid)
     VALUES ($1, $2, (SELECT mid FROM memberships ORDER BY score ASC, mid ASC LIMIT 1))
     ON CONFLICT (uid) DO NOTHING`,
    [event.uid, event.username]
  );
}

module.exports = { GetCustomer, GetMembership, UpdateCustomer, onUserRegistered };
