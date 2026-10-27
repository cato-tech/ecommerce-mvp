// Kiểm thử Shipment Service (TC-SHP-01..05). Cần Shipment Service và Kafka đang chạy.
// SKIP_KAFKA=1: không dùng Kafka, gọi thẳng hàm xử lý sự kiện (chỉ dùng khi KHÔNG có Kafka)
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { loadProto, grpc, createKafka } = require('@ecommerce/common');
const config = require('../src/config');

const client = new (loadProto('shipment.proto').ShipmentService)(
  `localhost:${config.grpcPort}`, grpc.credentials.createInsecure());
const call = (m, req) => new Promise((res) => client[m](req, (err, r) => res({ err, r })));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = grpc.status;
const code = (x) => x.err?.code;

let passed = 0, total = 0;
function check(label, cond, detail) {
  total++; if (cond) passed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  -> ' + detail}`);
}

const mongo = new MongoClient(config.mongoUrl);
let producer, handlers;

// Gửi một "sự kiện" tới Shipment Service như Order Service sẽ làm
async function deliver(event) {
  if (process.env.SKIP_KAFKA) return handlers.onOrderCreated(event);
  await producer.send({ topic: 'order-created', messages: [{ key: 'test', value: JSON.stringify(event) }] });
}
const mkEvent = (oid) => ({
  eventId: crypto.randomUUID(), oid, uid: 1, discount: 0, total_amount: 10,
  items: [{ pid: 1, qty: 1, unit_price: 10 }], occurredAt: new Date().toISOString(),
});
async function waitShipment(oid, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const x = await call('GetShipmentByOrder', { oid });
    if (!x.err) return x;
    await sleep(300);
  }
  return await call('GetShipmentByOrder', { oid });
}

(async () => {
  await mongo.connect();
  const db = mongo.db(config.dbName);
  if (process.env.SKIP_KAFKA) {
    await require('../src/db').connect();
    handlers = require('../src/handlers');
  } else {
    producer = createKafka('shipment-test').producer();
    await producer.connect();
  }

  const base = 800000000 + (Date.now() % 100000000);
  const failedBefore = await db.collection('failed_events').countDocuments();

  // TC-SHP-01: nhận OrderCreated hợp lệ -> tạo Shipment PENDING
  await deliver(mkEvent(base));
  let x = await waitShipment(base);
  const ship = x.r;
  check('TC-SHP-01 nhận OrderCreated -> tạo Shipment PENDING (trong 20s)',
    !x.err && ship.oid === base && ship.status === 'PENDING' && ship.shipid >= 5001, JSON.stringify(x.err?.message || x.r));
  x = await call('GetShipment', { shipid: ship?.shipid });
  check('API-SHP-01 lấy Shipment theo shipid', !x.err && x.r.oid === base && x.r.status === 'PENDING', JSON.stringify(x.err?.message || x.r));

  // TC-SHP-05: cùng một sự kiện nhiều lần -> không tạo trùng
  const dup = mkEvent(base);
  await deliver(dup); await deliver(dup);
  await deliver(mkEvent(base)); // eventId khác nhưng cùng oid
  const marker = base + 1;
  await deliver(mkEvent(marker)); // cùng partition nên xử lý sau các bản trùng; chờ nó là biết bản trùng đã được xử lý
  await waitShipment(marker);
  const n = await db.collection('shipments').countDocuments({ oid: base });
  x = await call('GetShipmentByOrder', { oid: base });
  check('TC-SHP-05 nhận trùng sự kiện -> vẫn đúng 1 Shipment, shipid không đổi', n === 1 && x.r?.shipid === ship.shipid, `count=${n}`);

  // TC-SHP-02: sự kiện thiếu / sai oid -> không tạo Shipment, có ghi nhận lỗi
  const bad = [
    { eventId: 'x', uid: 1 },                // thiếu oid
    { oid: 'abc', uid: 1 },                  // oid sai kiểu
    { oid: -5, uid: 1 },                     // oid âm
    { oid: base + 50 },                      // thiếu uid
    null,                                    // không phải object
  ];
  for (const ev of bad) await deliver(ev);
  await deliver(mkEvent(base + 2));
  await waitShipment(base + 2);
  const failedNow = await db.collection('failed_events').countDocuments();
  const created = await db.collection('shipments').countDocuments({ oid: { $in: [-5, base + 50] } });
  check('TC-SHP-02 sự kiện sai: không tạo Shipment, ghi nhận 5 lỗi vào failed_events', created === 0 && failedNow - failedBefore === bad.length, `created=${created} failed=${failedNow - failedBefore}`);

  // TC-SHP-03: cập nhật trạng thái
  x = await call('UpdateShipmentStatus', { shipid: ship.shipid, status: 'SHIPPING' });
  const g = await call('GetShipment', { shipid: ship.shipid });
  check('TC-SHP-03 PENDING -> SHIPPING', !x.err && x.r.status === 'SHIPPING' && g.r?.status === 'SHIPPING', JSON.stringify(x.err?.message || x.r));
  x = await call('UpdateShipmentStatus', { shipid: ship.shipid, status: 'SHIPPING' });
  check('Gửi lại cùng trạng thái -> không lỗi (idempotent)', !x.err && x.r.status === 'SHIPPING', x.err?.message);
  x = await call('UpdateShipmentStatus', { shipid: ship.shipid, status: 'DELIVERED' });
  check('SHIPPING -> DELIVERED', !x.err && x.r.status === 'DELIVERED', x.err?.message);
  x = await call('UpdateShipmentStatus', { shipid: ship.shipid, status: 'PENDING' });
  check('DELIVERED -> PENDING bị từ chối (409), trạng thái giữ nguyên', code(x) === S.ALREADY_EXISTS && (await call('GetShipment', { shipid: ship.shipid })).r.status === 'DELIVERED', code(x));

  x = await call('UpdateShipmentStatus', { shipid: ship.shipid, status: 'FLYING' });
  check('Trạng thái lạ -> INVALID_ARGUMENT (400)', code(x) === S.INVALID_ARGUMENT, code(x));
  x = await call('UpdateShipmentStatus', { shipid: ship.shipid, status: 'shipping' });
  check('Viết thường -> INVALID_ARGUMENT (400)', code(x) === S.INVALID_ARGUMENT, code(x));

  // TC-SHP-04: không tồn tại
  x = await call('UpdateShipmentStatus', { shipid: 99999999, status: 'SHIPPING' });
  check('TC-SHP-04 cập nhật Shipment không tồn tại -> NOT_FOUND (404)', code(x) === S.NOT_FOUND, code(x));
  x = await call('GetShipment', { shipid: 99999999 });
  check('Lấy Shipment không tồn tại -> NOT_FOUND', code(x) === S.NOT_FOUND, code(x));
  x = await call('GetShipmentByOrder', { oid: 2000000000 });
  check('Đơn chưa có Shipment -> NOT_FOUND', code(x) === S.NOT_FOUND, code(x));

  // CANCELLED là trạng thái cuối
  const c = (await waitShipment(base + 2)).r;
  x = await call('UpdateShipmentStatus', { shipid: c.shipid, status: 'CANCELLED' });
  const y = await call('UpdateShipmentStatus', { shipid: c.shipid, status: 'SHIPPING' });
  check('PENDING -> CANCELLED được; sau đó -> SHIPPING bị từ chối (409)', !x.err && code(y) === S.ALREADY_EXISTS, `${x.err?.message} / ${code(y)}`);

  // shipid tăng dần, không trùng
  const ids = (await Promise.all([base, marker, base + 2].map((o) => call('GetShipmentByOrder', { oid: o })))).map((r) => r.r.shipid);
  check('shipid là số nguyên, không trùng nhau', new Set(ids).size === 3 && ids.every((i) => Number.isInteger(i) && i >= 5001), JSON.stringify(ids));

  console.log(`\n${passed}/${total} đạt`);
  if (producer) await producer.disconnect();
  await mongo.close();
  process.exit(passed === total ? 0 : 1);
})();
