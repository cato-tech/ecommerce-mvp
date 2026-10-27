const { Kafka, logLevel } = require('kafkajs');

function createKafka(clientId) {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:19092').split(',');
  return new Kafka({
    clientId,
    brokers,
    logLevel: logLevel.WARN,
    retry: { initialRetryTime: 500, retries: 8 },
  });
}

async function ensureTopics(kafka, topics) {
  const admin = kafka.admin();
  await admin.connect();
  try {
    await admin.createTopics({
      topics: topics.map((topic) => ({ topic, numPartitions: 1 })),
      waitForLeaders: true,
    });
  } finally {
    await admin.disconnect();
  }
}

// Thử lại đến khi thành công: service không chết nếu Kafka khởi động chậm
async function retryUntilSuccess(label, fn, log, delayMs = 3000) {
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      log.warn(`${label} failed, retrying`, { error: err.message });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function startConsumer({ kafka, groupId, topic, handler, log }) {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ message }) => {
      let event;
      try {
        event = JSON.parse(message.value.toString());
      } catch {
        log.error('skip malformed message', { topic });
        return;
      }
      await handler(event); // lỗi ở đây => Kafka giao lại message
    },
  });
  return consumer;
}

module.exports = { createKafka, ensureTopics, retryUntilSuccess, startConsumer };
