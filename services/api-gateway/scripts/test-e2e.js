// Kiểm thử luồng chính từ đầu đến cuối qua API Gateway (REST):
// đăng ký -> đăng nhập -> đặt hàng -> Kafka -> Shipment PENDING -> nhân viên cập nhật -> khách xem trạng thái
// Cần chạy TẤT CẢ: Docker (7 container) và Auth, Customer, Product, Order, Shipment, API Gateway.
// LƯU Ý: dùng vài lượt đăng nhập, nếu vừa chạy test:api thì chờ >= 60 giây để hạn mức đăng nhập làm mới.
const BASE = `http://localhost:${process.env.GATEWAY_PORT || 18080}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
async function until(fn, ms = 30000) {
  const t0 = Date.now(); let r;
  while (Date.now() - t0 < ms) { r = await fn(); if (r.status === 200) return r; await sleep(500); }
  return r;
}
async function login(username, password) {
  const r = await req('POST', '/api/auth/login', { body: { username, password } });
  return r.body?.accessToken;
}

(async () => {
  const tag = Date.now() % 1000000;
  let r = await req('GET', '/api/health');
  check('Toàn hệ thống khỏe: health 200, mọi dependency UP', r.status === 200 && r.body.status === 'UP', d(r));

  // Hai khách hàng, một admin, một nhân viên giao hàng
  const mk = async (n) => {
    const u = `e2e${n}${tag}`;
    const reg = await req('POST', '/api/auth/register', { body: { username: u, password: 'P@ss123', email: `${u}@example.com` } });
    return { uid: reg.body?.uid, token: await login(u, 'P@ss123') };
  };
  const A = await mk('a'), B = await mk('b');
  const admin = await login('admin', process.env.ADMIN_PASSWORD || 'Admin@123');
  const staff = await login('shipper', process.env.STAFF_PASSWORD || 'Shipper@123');
  check('Có đủ 2 khách, admin và nhân viên giao hàng', A.token && B.token && admin && staff, 'đăng nhập thất bại (hạn mức đăng nhập?)');

  const ready = await until(() => req('GET', `/api/customers/${A.uid}`, { token: A.token }));
  check('Customer của khách A tự được tạo qua Kafka', ready.status === 200, d(ready));

  // Sản phẩm riêng cho bài test
  r = await req('POST', '/api/products', { token: admin, body: { pname: `E2E Item ${tag}`, price: 40, quantity: 5 } });
  const pid = r.body?.pid;
  check('Admin tạo sản phẩm (giá 40, kho 5)', r.status === 201 && pid > 0, d(r));

  // Đặt hàng
  r = await req('POST', '/api/orders', { token: A.token, body: { items: [{ pid, qty: 2 }] } });
  const order = r.body;
  check('Đặt hàng 2 sản phẩm -> 201, discount 0, tổng 80', r.status === 201 && order.oid >= 1001 && order.discount === 0 && order.total_amount === 80, d(r));
  r = await req('GET', `/api/products/${pid}`, { token: A.token });
  check('Kho giảm 5 -> 3 (cache sản phẩm đã được làm mới)', r.status === 200 && r.body.quantity === 3, d(r));

  // Shipment được tạo bất đồng bộ qua Kafka
  const sh = await until(() => req('GET', `/api/orders/${order.oid}/shipment`, { token: A.token }));
  const shipid = sh.body?.shipid;
  check('Shipment PENDING xuất hiện qua Kafka (trong 30s)', sh.status === 200 && sh.body.oid === order.oid && sh.body.status === 'PENDING' && shipid >= 5001, d(sh));

  // Phân quyền
  r = await req('GET', `/api/orders/${order.oid}/shipment`, { token: B.token });
  check('Khách B xem vận đơn của đơn khách A -> 403', r.status === 403, d(r));
  r = await req('GET', `/api/shipments/${shipid}`, { token: B.token });
  check('Khách B xem /api/shipments/:shipid của khách A -> 404 (không lộ tồn tại)', r.status === 404, d(r));
  r = await req('GET', `/api/orders/${order.oid}`, { token: B.token });
  check('Khách B xem đơn của khách A -> 403', r.status === 403, d(r));
  r = await req('PATCH', `/api/shipments/${shipid}/status`, { token: A.token, body: { status: 'SHIPPING' } });
  check('Khách không được cập nhật vận đơn -> 403', r.status === 403, d(r));

  // Nhân viên giao hàng cập nhật, khách theo dõi
  r = await req('PATCH', `/api/shipments/${shipid}/status`, { token: staff, body: { status: 'SHIPPING' } });
  check('Nhân viên cập nhật SHIPPING -> 200', r.status === 200 && r.body.status === 'SHIPPING', d(r));
  r = await req('GET', `/api/shipments/${shipid}`, { token: A.token });
  check('Khách A thấy trạng thái SHIPPING', r.status === 200 && r.body.status === 'SHIPPING' && r.body.oid === order.oid, d(r));
  r = await req('PATCH', `/api/shipments/${shipid}/status`, { token: staff, body: { status: 'FLYING' } });
  check('Trạng thái lạ -> 400', r.status === 400, d(r));
  r = await req('PATCH', `/api/shipments/${shipid}/status`, { token: staff, body: { status: 'DELIVERED' } });
  check('Nhân viên cập nhật DELIVERED -> 200', r.status === 200 && r.body.status === 'DELIVERED', d(r));
  r = await req('PATCH', `/api/shipments/${shipid}/status`, { token: staff, body: { status: 'PENDING' } });
  check('Quay lại PENDING sau khi đã giao -> 409', r.status === 409, d(r));
  r = await req('PATCH', `/api/shipments/99999999/status`, { token: admin, body: { status: 'SHIPPING' } });
  check('Vận đơn không tồn tại -> 404', r.status === 404, d(r));

  // Khách xem đơn và danh sách
  r = await req('GET', `/api/orders/${order.oid}`, { token: A.token });
  check('Khách A xem chi tiết đơn (dòng hàng, tổng)', r.status === 200 && r.body.items.length === 1 && r.body.total_amount === 80, d(r));
  r = await req('GET', '/api/orders', { token: A.token });
  check('Danh sách đơn của khách A chỉ có đơn của A', r.status === 200 && r.body.items.length === 1 && r.body.items[0].uid === A.uid, d(r));
  r = await req('GET', `/api/orders/${order.oid}/shipment`, { token: admin });
  check('Admin xem được vận đơn của mọi đơn', r.status === 200 && r.body.status === 'DELIVERED', d(r));

  // Không đủ hàng
  r = await req('POST', '/api/orders', { token: A.token, body: { items: [{ pid, qty: 99 }] } });
  check('Đặt quá tồn kho -> 409', r.status === 409, d(r));
  r = await req('GET', `/api/products/${pid}`, { token: A.token });
  check('Kho vẫn là 3 sau lần đặt thất bại', r.status === 200 && r.body.quantity === 3, d(r));

  console.log(`\n${passed}/${total} đạt`);
  process.exit(passed === total ? 0 : 1);
})();
