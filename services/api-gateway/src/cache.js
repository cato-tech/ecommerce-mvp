const redis = require('./redis');

// Trả về từ cache nếu có, nếu không thì gọi producer() rồi lưu lại
async function cached(res, key, ttlSec, producer) {
  try {
    const hit = await redis.get(key);
    if (hit) {
      res.set('X-Cache', 'HIT');
      return res.type('json').send(hit);
    }
  } catch { /* Redis lỗi: bỏ qua cache */ }

  const body = JSON.stringify(await producer());
  redis.set(key, body, 'EX', ttlSec).catch(() => {});
  res.set('X-Cache', 'MISS');
  return res.type('json').send(body);
}

// Xóa cache sản phẩm khi dữ liệu đổi (admin sửa, hoặc có đơn hàng làm đổi tồn kho)
async function invalidateProducts() {
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'cache:products:*', 'COUNT', 100);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } catch { /* hết hạn sau TTL ngắn */ }
}

module.exports = { cached, invalidateProducts };
