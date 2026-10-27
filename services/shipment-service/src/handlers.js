const { NotFound, BadRequest, Conflict, toGrpcError, createLogger } = require('@ecommerce/common');
const { shipments, failedEvents, nextShipid } = require('./db');

const log = createLogger('shipment-service');

const STATUSES = ['PENDING', 'SHIPPING', 'DELIVERED', 'CANCELLED'];
// Trạng thái hợp lệ tiếp theo; DELIVERED và CANCELLED là trạng thái cuối
const TRANSITIONS = {
  PENDING: ['SHIPPING', 'CANCELLED'],
  SHIPPING: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

const pick = (d) => d && { shipid: d.shipid, oid: d.oid, status: d.status };

const wrap = (fn) => async (call, callback) => {
  try {
    callback(null, await fn(call.request));
  } catch (err) {
    callback(toGrpcError(err));
  }
};

const GetShipment = wrap(async ({ shipid }) => {
  const s = await shipments().findOne({ shipid });
  if (!s) throw NotFound('Shipment not found');
  return pick(s);
});

const GetShipmentByOrder = wrap(async ({ oid }) => {
  const s = await shipments().findOne({ oid });
  if (!s) throw NotFound('Shipment not found (it may still be created)');
  return pick(s);
});

const UpdateShipmentStatus = wrap(async ({ shipid, status }) => {
  if (!STATUSES.includes(status)) {
    throw BadRequest(`Invalid status. Allowed: ${STATUSES.join(', ')}`);
  }
  const cur = await shipments().findOne({ shipid });
  if (!cur) throw NotFound('Shipment not found');
  if (cur.status === status) return pick(cur); // gửi lại cùng trạng thái: không đổi, không lỗi
  if (!TRANSITIONS[cur.status].includes(status)) {
    throw Conflict(`Cannot change status from ${cur.status} to ${status}`);
  }
  // Điều kiện status = trạng thái vừa đọc: hai người cập nhật cùng lúc thì chỉ một người thắng
  const r = await shipments().findOneAndUpdate(
    { shipid, status: cur.status },
    { $set: { status, updated_at: new Date() } },
    { returnDocument: 'after' }
  );
  if (!r) throw Conflict('Shipment status changed concurrently, please retry');
  log.info('shipment status updated', { shipid, from: cur.status, to: status });
  return pick(r);
});

function invalidReason(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return 'event is not an object';
  if (!Number.isInteger(event.oid) || event.oid <= 0) return 'missing or invalid oid';
  if (!Number.isInteger(event.uid) || event.uid <= 0) return 'missing or invalid uid';
  return null;
}

// Xử lý OrderCreated. IDEMPOTENT: nhận trùng sự kiện không tạo vận đơn thứ hai.
// Sự kiện sai: ghi vào failed_events và bỏ qua (KHÔNG ném lỗi, nếu không Kafka sẽ giao lại vô hạn).
async function onOrderCreated(event) {
  const reason = invalidReason(event);
  if (reason) {
    await failedEvents().insertOne({ topic: 'order-created', reason, event, at: new Date() });
    log.error('invalid OrderCreated event, skipped', { reason });
    return;
  }
  if (await shipments().findOne({ oid: event.oid }, { projection: { _id: 1 } })) {
    log.info('duplicate OrderCreated ignored', { oid: event.oid });
    return;
  }
  try {
    const shipid = await nextShipid();
    const now = new Date();
    await shipments().insertOne({ shipid, oid: event.oid, uid: event.uid, status: 'PENDING', created_at: now, updated_at: now });
    log.info('shipment created', { shipid, oid: event.oid });
  } catch (err) {
    if (err.code === 11000) { // hai bản của cùng sự kiện xử lý song song: bản đến sau bị chỉ mục unique chặn
      log.info('duplicate OrderCreated ignored (race)', { oid: event.oid });
      return;
    }
    throw err; // lỗi tạm thời (ví dụ MongoDB chập chờn): Kafka sẽ giao lại
  }
}

module.exports = { GetShipment, GetShipmentByOrder, UpdateShipmentStatus, onOrderCreated };
