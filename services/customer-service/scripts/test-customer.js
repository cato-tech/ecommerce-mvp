// Kiểm thử end-to-end: cần Auth Service + Customer Service + Kafka đang chạy
// Tương ứng TC-CUS-01..04 (TC-CUS-05 kiểm tra JWT ở API Gateway, làm ở Bước 6)
const { loadProto, grpc } = require('@ecommerce/common');

const host = (p) => `localhost:${p}`;
const auth = new (loadProto('auth.proto').AuthService)(
  host(process.env.AUTH_GRPC_PORT || 50051), grpc.credentials.createInsecure());
const cus = new (loadProto('customer.proto').CustomerService)(
  host(process.env.CUSTOMER_GRPC_PORT || 50052), grpc.credentials.createInsecure());

const call = (c, m, req) => new Promise((res) => c[m](req, (err, r) => res({ err, r })));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, total = 0;
function check(label, cond, detail) {
  total++; if (cond) passed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  -> ' + detail}`);
}
const code = (x) => x.err?.code;

(async () => {
  const name = 'cus' + (Date.now() % 1000000);
  const reg = await call(auth, 'Register', { username: name, password: 'P@ss123', email: name + '@example.com' });
  if (reg.err) { console.log('Không đăng ký được, Auth Service đã chạy chưa?', reg.err.message); process.exit(1); }
  const uid = reg.r.uid;

  // Chờ sự kiện UserRegistered đi qua Outbox -> Kafka -> Customer Service
  let x;
  for (let i = 0; i < 30; i++) {
    x = await call(cus, 'GetCustomer', { uid });
    if (!x.err) break;
    await sleep(1000);
  }
  check('Event UserRegistered -> Customer tự được tạo (trong 30s)', !x.err, x.err?.message);
  check('TC-CUS-01 lấy Customer tồn tại', !x.err && x.r.uid === uid && x.r.fullname === name && x.r.mid > 0, JSON.stringify(x.r));
  const mid0 = x.r?.mid;

  x = await call(cus, 'GetCustomer', { uid: 999999 });
  check('TC-CUS-02 Customer không tồn tại -> NOT_FOUND (404)', code(x) === grpc.status.NOT_FOUND, code(x));

  x = await call(cus, 'UpdateCustomer', { uid, fullname: 'John Smith', caller_uid: uid, caller_role: 'CUSTOMER' });
  const g = await call(cus, 'GetCustomer', { uid });
  check('TC-CUS-03 cập nhật fullname', !x.err && g.r?.fullname === 'John Smith', JSON.stringify(x.err?.message || g.r));

  x = await call(cus, 'GetMembership', { uid });
  check('TC-CUS-04 lấy Membership (mname, score)', !x.err && x.r.mname === 'BRONZE' && x.r.score === 0, JSON.stringify(x.r || x.err?.message));

  x = await call(cus, 'UpdateCustomer', { uid, fullname: 'John', mid: 3, caller_uid: uid, caller_role: 'CUSTOMER' });
  check('Khách tự đổi hạng -> PERMISSION_DENIED (403)', code(x) === grpc.status.PERMISSION_DENIED, code(x));

  x = await call(cus, 'UpdateCustomer', { uid, fullname: 'Hack', caller_uid: uid + 1, caller_role: 'CUSTOMER' });
  check('Khách sửa hồ sơ người khác -> PERMISSION_DENIED (403)', code(x) === grpc.status.PERMISSION_DENIED, code(x));

  x = await call(cus, 'UpdateCustomer', { uid, fullname: 'John Smith', mid: mid0, caller_uid: uid, caller_role: 'CUSTOMER' });
  check('Khách gửi lại mid hiện tại (không đổi) -> cho phép', !x.err, x.err?.message);

  x = await call(cus, 'UpdateCustomer', { uid, mid: 2, caller_uid: 1, caller_role: 'ADMIN' });
  const m = await call(cus, 'GetMembership', { uid });
  check('Admin đổi hạng -> score mới = 100', !x.err && m.r?.score === 100, JSON.stringify(x.err?.message || m.r));

  x = await call(cus, 'UpdateCustomer', { uid, mid: 9999, caller_uid: 1, caller_role: 'ADMIN' });
  check('mid không tồn tại -> INVALID_ARGUMENT (400)', code(x) === grpc.status.INVALID_ARGUMENT, code(x));

  x = await call(cus, 'UpdateCustomer', { uid, caller_uid: uid, caller_role: 'CUSTOMER' });
  check('Không gửi dữ liệu gì -> INVALID_ARGUMENT (400)', code(x) === grpc.status.INVALID_ARGUMENT, code(x));

  x = await call(cus, 'UpdateCustomer', { uid: 999999, fullname: 'A', caller_uid: 1, caller_role: 'ADMIN' });
  check('Admin sửa Customer không tồn tại -> NOT_FOUND (404)', code(x) === grpc.status.NOT_FOUND, code(x));

  console.log(`\n${passed}/${total} đạt`);
  process.exit(passed === total ? 0 : 1);
})();
