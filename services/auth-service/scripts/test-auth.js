// Kiểm thử Auth Service qua gRPC, tương ứng TC-IAM-01..05
const { loadProto, grpc } = require('@ecommerce/common');
const proto = loadProto('auth.proto');
const client = new proto.AuthService(
  `localhost:${process.env.AUTH_GRPC_PORT || 50051}`,
  grpc.credentials.createInsecure()
);
const call = (m, req) =>
  new Promise((res) => client[m](req, (err, r) => res({ err, r })));

const name = 'user' + Date.now() % 1000000;
let passed = 0, total = 0;
function check(label, cond, detail) {
  total++; if (cond) passed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  -> ' + detail}`);
}

(async () => {
  let x = await call('Register', { username: name, password: 'P@ss123', email: name + '@example.com', phone: '0900000000' });
  check('TC-IAM-01 đăng ký hợp lệ -> có uid', !x.err && x.r.uid > 0, JSON.stringify(x.err?.message));

  x = await call('Register', { username: name, password: 'P@ss123', email: 'other_' + name + '@example.com' });
  check('TC-IAM-02 trùng username -> ALREADY_EXISTS (409)', x.err?.code === grpc.status.ALREADY_EXISTS, JSON.stringify(x.err?.code));

  x = await call('Register', { username: name + 'b', password: '', email: name + 'b@example.com' });
  check('TC-IAM-03 thiếu password -> INVALID_ARGUMENT (400)', x.err?.code === grpc.status.INVALID_ARGUMENT, JSON.stringify(x.err?.code));

  x = await call('Login', { username: name, password: 'P@ss123' });
  check('TC-IAM-04 đăng nhập đúng -> có token', !x.err && !!x.r.access_token, JSON.stringify(x.err?.message));
  const token = x.r?.access_token;

  x = await call('Login', { username: name, password: 'sai-mat-khau' });
  check('TC-IAM-05 sai password -> UNAUTHENTICATED (401)', x.err?.code === grpc.status.UNAUTHENTICATED, JSON.stringify(x.err?.code));

  x = await call('VerifyToken', { token });
  check('VerifyToken token hợp lệ -> role CUSTOMER', !x.err && x.r.role === 'CUSTOMER' && x.r.uid > 0, JSON.stringify(x));

  x = await call('VerifyToken', { token: token + 'x' });
  check('VerifyToken token bị sửa -> UNAUTHENTICATED', x.err?.code === grpc.status.UNAUTHENTICATED, JSON.stringify(x.err?.code));

  x = await call('Login', { username: 'admin', password: 'Admin@123' });
  const a = x.r && await call('VerifyToken', { token: x.r.access_token });
  check('Tài khoản admin mẫu -> role ADMIN', a?.r?.role === 'ADMIN', JSON.stringify(a));

  console.log(`\n${passed}/${total} đạt`);
  process.exit(passed === total ? 0 : 1);
})();
