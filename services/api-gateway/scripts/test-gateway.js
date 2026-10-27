// Kiểm thử API Gateway qua HTTP thật.
// Cần chạy: Redis, Auth, Customer, Product, Kafka và API Gateway.
// Order/Shipment Service chưa có (Bước 7, 8) nên các route đó được kiểm tra ở mức xác thực/phân quyền/kiểm tra dữ liệu.
// LƯU Ý: bài kiểm tra rate limit dùng hết hạn mức đăng nhập, nên chạy lại cách nhau >= 60 giây.
const BASE = `http://localhost:${process.env.GATEWAY_PORT || 18080}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, { token, body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* không có body */ }
  return { status: res.status, body: json, headers: res.headers };
}

let passed = 0, total = 0;
function check(label, cond, detail) {
  total++; if (cond) passed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  -> ' + detail}`);
}
const d = (r) => `${r.status} ${JSON.stringify(r.body)}`;

(async () => {
  const name = 'gw' + (Date.now() % 1000000);

  // --- Health ---
  let r = await req('GET', '/api/health');
  check('API-HEALTH-01 có trạng thái từng dependency (503 nếu thiếu service là đúng)',
    [200, 503].includes(r.status) && r.body?.dependencies?.redis === 'UP' && r.body.dependencies['auth-service'] === 'UP', d(r));
  console.log('      dependencies:', JSON.stringify(r.body?.dependencies));

  // --- Auth ---
  r = await req('POST', '/api/auth/register', { body: { username: name, password: 'P@ss123', email: name + '@example.com', phone: '0900000000' } });
  check('TC-IAM-01 đăng ký -> 201 + uid', r.status === 201 && r.body.uid > 0 && r.body.message === 'User registered successfully', d(r));
  const uid = r.body?.uid;

  r = await req('POST', '/api/auth/register', { body: { username: name, password: 'P@ss123', email: 'x' + name + '@example.com' } });
  check('TC-IAM-02 trùng username -> 409', r.status === 409, d(r));

  r = await req('POST', '/api/auth/register', { body: { username: name + 'b', password: '', email: name + 'b@example.com' } });
  check('TC-IAM-03 thiếu password -> 400', r.status === 400, d(r));

  r = await req('POST', '/api/auth/login', { body: { username: name, password: 'P@ss123' } });
  check('TC-IAM-04 đăng nhập -> accessToken + Bearer + 3600', r.status === 200 && !!r.body.accessToken && r.body.tokenType === 'Bearer' && r.body.expiresIn === 3600, d(r));
  const token = r.body?.accessToken;

  r = await req('POST', '/api/auth/login', { body: { username: name, password: 'sai' } });
  check('TC-IAM-05 sai mật khẩu -> 401', r.status === 401, d(r));

  r = await req('POST', '/api/auth/login', { body: { username: 'admin', password: process.env.ADMIN_PASSWORD || 'Admin@123' } });
  const admin = r.body?.accessToken;
  check('Đăng nhập admin mẫu', r.status === 200 && !!admin, d(r));
  r = await req('POST', '/api/auth/login', { body: { username: 'shipper', password: process.env.STAFF_PASSWORD || 'Shipper@123' } });
  const staff = r.body?.accessToken;
  check('Đăng nhập shipment staff mẫu', r.status === 200 && !!staff, d(r));

  r = await req('POST', '/api/auth/login', { headers: { 'Content-Type': 'application/json' }, body: undefined });
  check('Login không có body -> 400', r.status === 400, d(r));

  // --- JWT ---
  r = await req('GET', '/api/customers/1');
  check('TC-CUS-05 không có token -> 401', r.status === 401, d(r));
  r = await req('GET', '/api/customers/1', { token: token + 'x' });
  check('Token bị sửa -> 401', r.status === 401, d(r));
  r = await req('GET', '/api/products', { headers: { Authorization: 'Basic abc' } });
  check('Sai kiểu Authorization -> 401', r.status === 401, d(r));

  // --- Customers ---
  let cr;
  for (let i = 0; i < 30; i++) { cr = await req('GET', `/api/customers/${uid}`, { token }); if (cr.status === 200) break; await sleep(1000); }
  check('API-CUS-01 xem hồ sơ của mình (chờ sự kiện tạo Customer)', cr.status === 200 && cr.body.uid === uid, d(cr));

  r = await req('GET', `/api/customers/${uid + 1}`, { token });
  check('Khách xem hồ sơ người khác -> 403', r.status === 403, d(r));
  r = await req('GET', `/api/customers/${uid}`, { token: admin });
  check('Admin xem hồ sơ bất kỳ -> 200', r.status === 200, d(r));
  r = await req('GET', '/api/customers/999999', { token: admin });
  check('Customer không tồn tại -> 404', r.status === 404, d(r));
  r = await req('GET', '/api/customers/abc', { token });
  check('uid không hợp lệ -> 400', r.status === 400, d(r));

  r = await req('PUT', `/api/customers/${uid}`, { token, body: { fullname: 'John Smith' } });
  check('API-CUS-02 cập nhật fullname -> 200', r.status === 200 && r.body.message === 'Customer updated successfully', d(r));
  r = await req('PUT', `/api/customers/${uid}`, { token, body: { mid: 3 } });
  check('Khách tự đổi hạng -> 403', r.status === 403, d(r));
  r = await req('PUT', `/api/customers/${uid}`, { token: admin, body: { mid: 2 } });
  check('Admin đổi hạng -> 200', r.status === 200, d(r));
  r = await req('PUT', `/api/customers/${uid}`, { token, body: { fullname: 123 } });
  check('fullname sai kiểu -> 400', r.status === 400, d(r));

  // --- Products + cache ---
  r = await req('GET', '/api/products');
  check('Sản phẩm không token -> 401', r.status === 401, d(r));

  r = await req('GET', '/api/products', { token });
  const first = r.headers.get('x-cache');
  check('TC-PRO-01 danh sách sản phẩm', r.status === 200 && r.body.items.length >= 2, d(r));
  r = await req('GET', '/api/products', { token });
  check('Lần 2 lấy từ cache Redis (X-Cache: HIT)', r.status === 200 && r.headers.get('x-cache') === 'HIT' && first === 'MISS', `first=${first} second=${r.headers.get('x-cache')}`);

  r = await req('GET', '/api/products/1', { token });
  check('TC-PRO-02 sản phẩm theo pid', r.status === 200 && r.body.pid === 1, d(r));
  r = await req('GET', '/api/products/999999', { token });
  check('TC-PRO-03 sản phẩm không tồn tại -> 404', r.status === 404, d(r));

  r = await req('POST', '/api/products', { token, body: { pname: 'GW Item', price: 9.5, quantity: 3 } });
  check('Khách tạo sản phẩm -> 403', r.status === 403, d(r));
  r = await req('POST', '/api/products', { token: admin, body: { pname: 'GW Item', price: 9.5, quantity: 3 } });
  check('TC-PRO-04 admin tạo sản phẩm -> 201', r.status === 201 && r.body.pid > 0, d(r));
  const pid = r.body?.pid;
  r = await req('POST', '/api/products', { token: admin, body: { pname: 'Bad', price: 'abc', quantity: 3 } });
  check('Dữ liệu sai kiểu -> 400', r.status === 400, d(r));
  r = await req('POST', '/api/products', { token: admin, body: { pname: 'Bad', price: -1, quantity: 3 } });
  check('Giá âm -> 400 (Product Service từ chối)', r.status === 400, d(r));

  r = await req('GET', '/api/products', { token });
  check('Sau khi admin tạo mới, cache đã bị xóa (X-Cache: MISS) và có sản phẩm mới', r.headers.get('x-cache') === 'MISS' && r.body.items.some((p) => p.pid === pid), `x-cache=${r.headers.get('x-cache')}`);

  r = await req('PUT', `/api/products/${pid}`, { token: admin, body: { pname: 'GW Item 2', price: 12, quantity: 20 } });
  check('TC-PRO-05 admin cập nhật -> 200', r.status === 200 && r.body.message === 'Product updated successfully', d(r));
  r = await req('GET', `/api/products/${pid}`, { token });
  check('Đọc lại thấy dữ liệu mới (không bị cache cũ)', r.status === 200 && r.body.quantity === 20 && r.body.pname === 'GW Item 2', d(r));
  r = await req('DELETE', `/api/products/${pid}`, { token });
  check('Khách xóa sản phẩm -> 403', r.status === 403, d(r));
  r = await req('DELETE', `/api/products/${pid}`, { token: admin });
  check('Admin xóa -> 200', r.status === 200, d(r));
  r = await req('GET', `/api/products/${pid}`, { token });
  check('Sau khi xóa -> 404', r.status === 404, d(r));

  // --- Orders / Shipments (Order, Shipment Service chưa có) ---
  r = await req('POST', '/api/orders', { body: { items: [{ pid: 1, qty: 1 }] } });
  check('TC-ORD-02 đặt hàng không token -> 401', r.status === 401, d(r));
  r = await req('POST', '/api/orders', { token: admin, body: { items: [{ pid: 1, qty: 1 }] } });
  check('Admin đặt hàng -> 403 (chỉ CUSTOMER)', r.status === 403, d(r));
  r = await req('POST', '/api/orders', { token, body: { items: [] } });
  check('Đơn không có sản phẩm -> 400', r.status === 400, d(r));
  r = await req('POST', '/api/orders', { token, body: { items: [{ pid: 1, qty: 0 }] } });
  check('qty = 0 -> 400', r.status === 400, d(r));
  r = await req('POST', '/api/orders', { token, body: { items: [{ pid: 1, qty: 1 }] } });
  check('Order Service chưa chạy -> 503 (hoặc 201 nếu đã có)', [201, 503].includes(r.status), d(r));
  r = await req('PATCH', '/api/shipments/abc/status', { token, body: { status: 'SHIPPING' } });
  check('Khách cập nhật vận đơn -> 403', r.status === 403, d(r));
  r = await req('PATCH', '/api/shipments/abc/status', { token: staff, body: {} });
  check('Staff thiếu status -> 400', r.status === 400, d(r));
  r = await req('GET', '/api/shipments/abc');
  check('Xem vận đơn không token -> 401', r.status === 401, d(r));

  // --- Khác ---
  r = await req('GET', '/api/khong-co');
  check('Route không tồn tại -> 404 JSON', r.status === 404 && r.body?.status === 404, d(r));
  r = await req('GET', '/api/health', { headers: { 'X-Request-Id': 'my-trace-123' } });
  check('X-Request-Id được giữ lại để truy vết', r.headers.get('x-request-id') === 'my-trace-123', r.headers.get('x-request-id'));
  check('Không lộ X-Powered-By', !r.headers.get('x-powered-by'), r.headers.get('x-powered-by'));

  // --- Rate limit (đặt cuối cùng) ---
  let limited = null;
  for (let i = 0; i < 15; i++) {
    const x = await req('POST', '/api/auth/login', { body: { username: name, password: 'sai' + i } });
    if (x.status === 429) { limited = x; break; }
  }
  check('Rate limit đăng nhập -> 429 kèm Retry-After', limited && limited.headers.get('retry-after') > 0, limited ? d(limited) : 'không bị chặn sau 15 lần');

  console.log(`\n${passed}/${total} đạt`);
  process.exit(passed === total ? 0 : 1);
})();
