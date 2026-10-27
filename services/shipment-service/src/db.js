const { MongoClient } = require('mongodb');
const config = require('./config');

const client = new MongoClient(config.mongoUrl, { serverSelectionTimeoutMS: 5000 });
let db;

async function connect() {
  await client.connect();
  db = client.db(config.dbName);
  // oid duy nhất: mỗi đơn hàng chỉ có một vận đơn (nền tảng của tính idempotent)
  await db.collection('shipments').createIndex({ oid: 1 }, { unique: true });
  await db.collection('shipments').createIndex({ shipid: 1 }, { unique: true });
  return db;
}

const shipments = () => db.collection('shipments');
const failedEvents = () => db.collection('failed_events');

// shipid số nguyên tăng dần bắt đầu từ 5001, cấp phát nguyên tử bằng $inc
async function nextShipid() {
  const r = await db.collection('counters').findOneAndUpdate(
    { _id: 'shipment' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return config.firstShipid - 1 + r.seq;
}

module.exports = { connect, shipments, failedEvents, nextShipid, close: () => client.close() };
