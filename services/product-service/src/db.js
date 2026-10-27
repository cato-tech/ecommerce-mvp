const { MongoClient } = require('mongodb');
const config = require('./config');

const client = new MongoClient(config.mongoUrl, { serverSelectionTimeoutMS: 5000 });
let db;

async function connect() {
  await client.connect();
  db = client.db(config.dbName);
  await db.collection('products').createIndex({ pid: 1 }, { unique: true });
  return db;
}

const products = () => db.collection('products');
const counters = () => db.collection('counters');

// pid kiểu số nguyên tăng dần (đúng ERD/API: pid = 1, 2, ...), cấp phát nguyên tử bằng $inc
async function nextPid() {
  const r = await counters().findOneAndUpdate(
    { _id: 'product' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return r.seq;
}

module.exports = { connect, products, nextPid, close: () => client.close() };
