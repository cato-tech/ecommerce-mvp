const crypto = require('crypto');
const {
  BadRequest, NotFound, Forbidden, toGrpcError, enqueue, createLogger,
} = require('@ecommerce/common');
const { pool } = require('./db');
const config = require('./config');
const { discountForScore } = require('./discount');
const { clients, call, fromDownstream, grpc } = require('./clients');

const log = createLogger('order-service');

const wrap = (fn) => async (call_, callback) => {
  try {
    callback(null, await fn(call_.request));
  } catch (err) {
    callback(toGrpcError(err));
  }
};

const toCents = (n) => Math.round(Number(n) * 100);

// Gộp các dòng trùng pid (khóa chính order_details là (oid, pid))
function normalizeItems(items) {
  if (!items || items.length === 0) throw BadRequest('items must not be empty');
  const merged = new Map();
  for (const { pid, qty } of items) {
    if (!Number.isInteger(pid) || pid <= 0) throw BadRequest('invalid pid');
    if (!Number.isInteger(qty) || qty <= 0) throw BadRequest('qty must be an integer > 0');
    merged.set(pid, (merged.get(pid) || 0) + qty);
  }
  return [...merged].map(([pid, qty]) => ({ pid, qty }));
}

// Tính bằng số nguyên "xu" để tránh sai số số thực
function totalAmount(lines, discountPercent) {
  const subtotal = lines.reduce((s, l) => s + l.unitCents * l.qty, 0);
  return Math.round((subtotal * (100 - discountPercent)) / 100) / 100;
}

function toOrder({ oid, uid, discount, lines }) {
  return {
    oid, uid, discount,
    total_amount: totalAmount(lines, discount),
    items: lines.map((l) => ({ pid: l.pid, qty: l.qty, unit_price: l.unitCents / 100 })),
  };
}

// Lưu Order + OrderDetail + OutboxEvent trong CÙNG MỘT transaction
async function persistOrder(uid, discount, lines) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO orders (uid, discount) VALUES ($1, $2) RETURNING oid',
      [uid, discount]
    );
    const oid = rows[0].oid;
    await client.query(
      `INSERT INTO order_details (oid, pid, qty, unit_price)
       SELECT $1, * FROM unnest($2::int[], $3::int[], $4::numeric[])`,
      [oid, lines.map((l) => l.pid), lines.map((l) => l.qty), lines.map((l) => l.unitCents / 100)]
    );
    const order = toOrder({ oid, uid, discount, lines });
    await enqueue(client, {
      topic: 'order-created',
      key: oid,
      payload: {
        eventId: crypto.randomUUID(),
        oid, uid, discount,
        total_amount: order.total_amount,
        items: order.items,
        occurredAt: new Date().toISOString(),
      },
    });
    await client.query('COMMIT');
    return order;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Bù trừ: hoàn kho khi không lưu được đơn
async function releaseStock(items, uid) {
  try {
    await call(clients.product, 'ReleaseStock', { items });
  } catch (err) {
    // Không hoàn được: ghi log đủ thông tin để đối soát thủ công
    log.error('RELEASE STOCK FAILED - manual reconciliation needed', { uid, items, error: err.message });
  }
}

const CreateOrder = wrap(async ({ uid, items }) => {
  if (!Number.isInteger(uid) || uid <= 0) throw BadRequest('invalid uid');
  const wanted = normalizeItems(items);

  // 1) Điểm thành viên (đồng thời xác nhận Customer tồn tại -> 404 nếu không)
  let membership;
  try {
    membership = await call(clients.customer, 'GetMembership', { uid });
  } catch (err) {
    throw fromDownstream(err);
  }
  const discount = discountForScore(membership.score);

  // 2) Kiểm tra và trừ kho (nguyên tử, all-or-nothing), nhận lại giá hiện tại
  let reserved;
  try {
    reserved = await call(clients.product, 'ReserveStock', { items: wanted });
  } catch (err) {
    if (err.code === grpc.status.DEADLINE_EXCEEDED || err.code === grpc.status.UNAVAILABLE) {
      // Không biết kho đã bị trừ hay chưa: KHÔNG hoàn kho để tránh cộng thừa, ghi log để đối soát
      log.error('stock reservation outcome unknown', { uid, items: wanted });
    }
    throw fromDownstream(err);
  }
  const price = new Map(reserved.items.map((p) => [p.pid, toCents(p.price)]));
  const lines = wanted.map(({ pid, qty }) => ({ pid, qty, unitCents: price.get(pid) }));

  // 3) Lưu đơn; nếu thất bại thì hoàn kho rồi báo lỗi
  try {
    return await persistOrder(uid, discount, lines);
  } catch (err) {
    await releaseStock(wanted, uid);
    throw err;
  }
});

const ListOrders = wrap(async ({ uid, role }) => {
  const { rows } = await pool.query(
    `SELECT o.oid, o.uid, o.discount,
            COALESCE(SUM(ROUND(d.unit_price * 100)::bigint * d.qty), 0)::bigint AS subtotal_cents
       FROM orders o LEFT JOIN order_details d ON d.oid = o.oid
      WHERE ($1::boolean OR o.uid = $2)
      GROUP BY o.oid
      ORDER BY o.oid DESC
      LIMIT $3`,
    [role === 'ADMIN', uid, config.listLimit]
  );
  return {
    items: rows.map((r) => {
      const discount = Number(r.discount);
      return {
        oid: r.oid, uid: r.uid, discount,
        total_amount: Math.round((Number(r.subtotal_cents) * (100 - discount)) / 100) / 100,
        items: [], // danh sách không kèm chi tiết, xem chi tiết bằng GetOrder
      };
    }),
  };
});

const GetOrder = wrap(async ({ oid, uid, role }) => {
  const o = await pool.query('SELECT oid, uid, discount FROM orders WHERE oid = $1', [oid]);
  if (!o.rows[0]) throw NotFound('Order not found');
  if (role !== 'ADMIN' && o.rows[0].uid !== uid) throw Forbidden('You can only view your own orders');

  const d = await pool.query(
    'SELECT pid, qty, unit_price FROM order_details WHERE oid = $1 ORDER BY pid',
    [oid]
  );
  const lines = d.rows.map((r) => ({ pid: r.pid, qty: r.qty, unitCents: toCents(r.unit_price) }));
  return toOrder({ oid, uid: o.rows[0].uid, discount: Number(o.rows[0].discount), lines });
});

module.exports = { CreateOrder, ListOrders, GetOrder };
