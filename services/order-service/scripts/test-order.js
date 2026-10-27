// Kiểm thử Order Service qua gRPC (TC-ORD-01, 03, 04, 05 và các tình huống nhất quán dữ liệu)
// Cần chạy: Auth, Customer, Product, Order Service và Kafka.
// Biến môi trường tùy chọn:
//   SKIP_KAFKA_CHECK=1   bỏ bước đọc sự kiện từ Kafka (chỉ kiểm tra Outbox trong DB)
//   SKIP_CONCURRENCY=1   bỏ bài đặt hàng đồng thời (chỉ dùng khi KHÔNG có MongoDB thật)
const { Pool } = require('pg');
const { loadProto, grpc, createKafka } = require('@ecommerce/common');
const config = require('../src/config');

const creds = grpc.credentials.createInsecure();
const port = (name, d) => process.env[name] || d;
const auth = new (loadProto('auth.proto').AuthService)(`localhost:${port('AUTH_GRPC_PORT', 50051)}`, creds);
const cus = new (loadProto('customer.proto').CustomerService)(`localhost:${port('CUSTOMER_GRPC_PORT', 50052)}`, creds);
const prod = new (loadProto('product.proto').ProductService)(`localhost:${port('PRODUCT_GRPC_PORT', 50053)}`, creds);
const ord = new (loadProto('order.proto').OrderService)(`localhost:${config.grpcPort}`, creds);
const db = new Pool({ connectionString: config.dbUrl });

const call = (c, m, req) => new Promise((res) => c[m](req, (err, r) => res({ err, r })));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = grpc.status;
const code = (x) => x.err?.code;

let passed = 0, total = 0;
function check(label, cond, detail) {
  total++; if (cond) passed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  -> ' + detail}`);
}
const stock = async (pid) => (await call(prod, 'GetProduct', { pid })).r?.quantity;
const orderCount = async (uid) => (await call(ord, 'ListOrders', { uid, role: 'CUSTOMER' })).r?.items.length;
const mkProduct = async (pname, price, quantity) => (await call(prod, 'CreateProduct', { pname, price, quantity })).r.pid;

async function waitForKafkaEvent(oid, timeoutMs = 20000) {
  const kafka = createKafka('order-test');
  const consumer = kafka.consumer({ groupId: 'order-test-' + Date.now() });
  await consumer.connect();
  await consumer.subscribe({ topic: 'order-created', fromBeginning: true });
  let found = null;
  await consumer.run({
    eachMessage: async ({ message }) => {
      const ev = JSON.parse(message.value.toString());
      if (ev.oid === oid) found = ev;
    },
  });
  const t0 = Date.now();
  while (!found && Date.now() - t0 < timeoutMs) await sleep(300);
  await consumer.disconnect();
  return found;
}

(async () => {
  // ---- Chuẩn bị: một khách hàng mới (qua Auth -> Kafka -> Customer) và 2 sản phẩm ----
  const name = 'ord' + (Date.now() % 1000000);
  const reg = await call(auth, 'Register', { username: name, password: 'P@ss123', email: name + '@example.com' });
  if (reg.err) { console.log('Không đăng ký được:', reg.err.message); process.exit(1); }
  const uid = reg.r.uid;
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) { ready = !(await call(cus, 'GetCustomer', { uid })).err; if (!ready) await sleep(1000); }
  if (!ready) { console.log('Customer chưa được tạo (kiểm tra Kafka / Customer Service)'); process.exit(1); }

  const A = await mkProduct('Order Test A', 100, 10);
  const B = await mkProduct('Order Test B', 25.5, 5);

  // ---- TC-ORD-01: tạo đơn, hạng BRONZE (0%) ----
  let x = await call(ord, 'CreateOrder', { uid, items: [{ pid: A, qty: 2 }, { pid: B, qty: 1 }] });
  const o1 = x.r;
  check('TC-ORD-01 tạo đơn: oid, giá, discount 0%, tổng 225.5',
    !x.err && o1.oid >= 1001 && o1.discount === 0 && o1.total_amount === 225.5 &&
    o1.items.length === 2 && o1.items.find((i) => i.pid === A).unit_price === 100,
    JSON.stringify(x.err?.message || x.r));
  check('Tồn kho bị trừ đúng (A: 10->8, B: 5->4)', (await stock(A)) === 8 && (await stock(B)) === 4, `${await stock(A)}/${await stock(B)}`);

  x = await call(ord, 'GetOrder', { oid: o1?.oid, uid, role: 'CUSTOMER' });
  check('Order Detail đã lưu: GetOrder trả đúng dòng hàng và tổng', !x.err && x.r.items.length === 2 && x.r.total_amount === 225.5, JSON.stringify(x.err?.message || x.r));

  // ---- TC-ORD-03: không đủ hàng ----
  const before = await orderCount(uid);
  x = await call(ord, 'CreateOrder', { uid, items: [{ pid: A, qty: 999 }] });
  check('TC-ORD-03 không đủ hàng -> ALREADY_EXISTS (409)', code(x) === S.ALREADY_EXISTS, code(x));
  check('  ...không tạo đơn mới và kho giữ nguyên', (await orderCount(uid)) === before && (await stock(A)) === 8, `orders=${await orderCount(uid)} stockA=${await stock(A)}`);

  // ---- TC-ORD-04: discount theo hạng thành viên ----
  await call(cus, 'UpdateCustomer', { uid, mid: 2, caller_uid: 1, caller_role: 'ADMIN' }); // SILVER, score 100
  x = await call(ord, 'CreateOrder', { uid, items: [{ pid: A, qty: 1 }] });
  check('TC-ORD-04 SILVER (score 100) -> giảm 5%, tổng 95', !x.err && x.r.discount === 5 && x.r.total_amount === 95, JSON.stringify(x.err?.message || x.r));
  await call(cus, 'UpdateCustomer', { uid, mid: 3, caller_uid: 1, caller_role: 'ADMIN' }); // GOLD, score 500
  x = await call(ord, 'CreateOrder', { uid, items: [{ pid: A, qty: 1 }] });
  check('TC-ORD-04 GOLD (score 500) -> giảm 10%, tổng 90', !x.err && x.r.discount === 10 && x.r.total_amount === 90, JSON.stringify(x.err?.message || x.r));
  const lastOrder = x.r;

  // ---- Lỗi dữ liệu / không tồn tại, và đảm bảo không để lại tác dụng phụ ----
  const stockA = await stock(A);
  x = await call(ord, 'CreateOrder', { uid, items: [{ pid: A, qty: 1 }, { pid: 999999, qty: 1 }] });
  check('Một sản phẩm không tồn tại -> NOT_FOUND, kho của sản phẩm còn lại không đổi', code(x) === S.NOT_FOUND && (await stock(A)) === stockA, `${code(x)} stockA=${await stock(A)}`);
  x = await call(ord, 'CreateOrder', { uid: 999999, items: [{ pid: A, qty: 1 }] });
  check('Customer không tồn tại -> NOT_FOUND, kho không đổi', code(x) === S.NOT_FOUND && (await stock(A)) === stockA, `${code(x)} stockA=${await stock(A)}`);
  x = await call(ord, 'CreateOrder', { uid, items: [] });
  check('Đơn rỗng -> INVALID_ARGUMENT (400)', code(x) === S.INVALID_ARGUMENT, code(x));
  x = await call(ord, 'CreateOrder', { uid, items: [{ pid: A, qty: 0 }] });
  check('qty = 0 -> INVALID_ARGUMENT (400)', code(x) === S.INVALID_ARGUMENT, code(x));
  x = await call(ord, 'CreateOrder', { uid: 0, items: [{ pid: A, qty: 1 }] });
  check('uid không hợp lệ -> INVALID_ARGUMENT (400)', code(x) === S.INVALID_ARGUMENT, code(x));

  x = await call(ord, 'CreateOrder', { uid, items: [{ pid: B, qty: 1 }, { pid: B, qty: 2 }] });
  check('Trùng pid được gộp thành một dòng qty = 3', !x.err && x.r.items.length === 1 && x.r.items[0].qty === 3, JSON.stringify(x.err?.message || x.r));

  // ---- Bù trừ: giá quá lớn làm lưu DB thất bại (NUMERIC(10,2)), kho phải được hoàn lại ----
  const C = await mkProduct('Order Test Huge Price', 1e9, 5);
  const ordersBefore = await orderCount(uid);
  x = await call(ord, 'CreateOrder', { uid, items: [{ pid: C, qty: 1 }] });
  check('Lưu đơn thất bại -> INTERNAL (không lộ chi tiết)', code(x) === S.INTERNAL && !/numeric|overflow|sql/i.test(x.err?.message || ''), `${code(x)} ${x.err?.message}`);
  check('  ...kho được hoàn lại (5) và không có đơn nào được tạo', (await stock(C)) === 5 && (await orderCount(uid)) === ordersBefore, `stock=${await stock(C)}`);

  // ---- Phân quyền xem đơn ----
  x = await call(ord, 'GetOrder', { oid: lastOrder.oid, uid: uid + 1, role: 'CUSTOMER' });
  check('Khách xem đơn của người khác -> PERMISSION_DENIED (403)', code(x) === S.PERMISSION_DENIED, code(x));
  x = await call(ord, 'GetOrder', { oid: lastOrder.oid, uid: 1, role: 'ADMIN' });
  check('Admin xem đơn bất kỳ', !x.err && x.r.oid === lastOrder.oid, x.err?.message);
  x = await call(ord, 'GetOrder', { oid: 999999, uid, role: 'CUSTOMER' });
  check('Đơn không tồn tại -> NOT_FOUND (404)', code(x) === S.NOT_FOUND, code(x));
  x = await call(ord, 'ListOrders', { uid, role: 'CUSTOMER' });
  check('Khách chỉ thấy đơn của mình', !x.err && x.r.items.length >= 4 && x.r.items.every((o) => o.uid === uid), JSON.stringify(x.err?.message || x.r.items.map((o) => o.uid)));
  x = await call(ord, 'ListOrders', { uid: 1, role: 'ADMIN' });
  check('Admin thấy đơn của khách', !x.err && x.r.items.some((o) => o.uid === uid), x.err?.message);

  // ---- TC-ORD-05: sự kiện OrderCreated ----
  const row = await db.query("SELECT payload, published_at FROM outbox_events WHERE topic = 'order-created' AND key = $1", [String(o1.oid)]);
  check('TC-ORD-05 sự kiện OrderCreated đã ghi vào Outbox cùng đơn hàng',
    row.rowCount === 1 && row.rows[0].payload.oid === o1.oid && row.rows[0].payload.uid === uid && row.rows[0].payload.items.length === 2,
    JSON.stringify(row.rows[0]?.payload));
  const noDup = await db.query("SELECT count(*)::int AS n FROM outbox_events WHERE topic = 'order-created' AND key = $1", [String(o1.oid)]);
  check('  ...mỗi đơn đúng một sự kiện', noDup.rows[0].n === 1, noDup.rows[0].n);

  if (process.env.SKIP_KAFKA_CHECK) {
    console.log('SKIP  sự kiện đến Kafka (SKIP_KAFKA_CHECK=1)');
  } else {
    const ev = await waitForKafkaEvent(o1.oid);
    check('  ...sự kiện thật sự đến Kafka (topic order-created, trong 20s)', !!ev && ev.uid === uid && ev.total_amount === 225.5, 'không nhận được');
  }

  // ---- Chống bán quá số lượng ở mức đơn hàng ----
  if (process.env.SKIP_CONCURRENCY) {
    console.log('SKIP  đặt hàng đồng thời (SKIP_CONCURRENCY=1)');
  } else {
    const D = await mkProduct('Order Test Concurrent', 10, 3);
    const results = await Promise.all(Array.from({ length: 8 }, () => call(ord, 'CreateOrder', { uid, items: [{ pid: D, qty: 1 }] })));
    const ok = results.filter((r) => !r.err).length;
    const rejected = results.filter((r) => code(r) === S.ALREADY_EXISTS).length;
    const rows = await db.query('SELECT count(*)::int AS n FROM order_details WHERE pid = $1', [D]);
    check('8 đơn đồng thời, kho 3 -> đúng 3 đơn thành công, 5 bị từ chối, kho = 0',
      ok === 3 && rejected === 5 && (await stock(D)) === 0 && rows.rows[0].n === 3,
      `ok=${ok} rejected=${rejected} stock=${await stock(D)} details=${rows.rows[0].n}`);
  }

  console.log(`\n${passed}/${total} đạt`);
  await db.end();
  process.exit(passed === total ? 0 : 1);
})();
