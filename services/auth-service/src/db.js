const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { OUTBOX_DDL } = require('@ecommerce/common');
const config = require('./config');

const pool = new Pool({ connectionString: config.dbUrl });

// Tạo bảng nếu chưa có (đủ cho MVP; hệ thống thật nên dùng công cụ migration)
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  await pool.query(OUTBOX_DDL);
}

module.exports = { pool, migrate };
