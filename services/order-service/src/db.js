const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { OUTBOX_DDL } = require('@ecommerce/common');
const config = require('./config');

const pool = new Pool({ connectionString: config.dbUrl });

async function migrate() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await pool.query(OUTBOX_DDL);
}

module.exports = { pool, migrate };
