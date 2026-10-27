// Transactional Outbox: ghi sự kiện vào bảng outbox_events CÙNG transaction với dữ liệu nghiệp vụ,
// một tiến trình nền sẽ đọc và gửi lên Kafka. Gửi ít nhất một lần => bên nhận phải idempotent.
const OUTBOX_DDL = `
CREATE TABLE IF NOT EXISTS outbox_events (
  id           BIGSERIAL PRIMARY KEY,
  topic        VARCHAR(100) NOT NULL,
  key          VARCHAR(100),
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events (id) WHERE published_at IS NULL;
`;

// client: kết nối đang trong transaction (BEGIN ... COMMIT)
async function enqueue(client, { topic, key, payload }) {
  await client.query(
    'INSERT INTO outbox_events (topic, key, payload) VALUES ($1, $2, $3)',
    [topic, key == null ? null : String(key), JSON.stringify(payload)]
  );
}

function startOutboxPublisher({ pool, kafka, log, intervalMs = 1000, batch = 50 }) {
  const producer = kafka.producer();
  let connected = false;
  let stopped = false;
  let timer;

  async function tick() {
    let client;
    try {
      if (!connected) {
        await producer.connect();
        connected = true;
      }
      client = await pool.connect();
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, topic, key, payload FROM outbox_events
          WHERE published_at IS NULL ORDER BY id LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [batch]
      );
      if (rows.length) {
        const byTopic = new Map();
        for (const r of rows) {
          if (!byTopic.has(r.topic)) byTopic.set(r.topic, []);
          byTopic.get(r.topic).push({ key: r.key, value: JSON.stringify(r.payload) });
        }
        await producer.sendBatch({
          topicMessages: [...byTopic].map(([topic, messages]) => ({ topic, messages })),
        });
        await client.query(
          'UPDATE outbox_events SET published_at = now() WHERE id = ANY($1::bigint[])',
          [rows.map((r) => r.id)]
        );
        log.info('outbox published', { count: rows.length });
      }
      await client.query('COMMIT');
    } catch (err) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      log.warn('outbox publish failed, will retry', { error: err.message });
    } finally {
      if (client) client.release();
    }
  }

  async function loop() {
    if (stopped) return;
    await tick();
    timer = setTimeout(loop, intervalMs);
  }
  loop();

  return async () => {
    stopped = true;
    clearTimeout(timer);
    await producer.disconnect().catch(() => {});
  };
}

module.exports = { OUTBOX_DDL, enqueue, startOutboxPublisher };
