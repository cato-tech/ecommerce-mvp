// Kiểm thử Product Service qua gRPC, tương ứng TC-PRO-01..05 và các tình huống kho hàng
const { loadProto, grpc } = require('@ecommerce/common');

const client = new (loadProto('product.proto').ProductService)(
  `localhost:${process.env.PRODUCT_GRPC_PORT || 50053}`, grpc.credentials.createInsecure());
const call = (m, req) => new Promise((res) => client[m](req, (err, r) => res({ err, r })));
const code = (x) => x.err?.code;
const S = grpc.status;

let passed = 0, total = 0;
function check(label, cond, detail) {
  total++; if (cond) passed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  -> ' + detail}`);
}
const qtyOf = async (pid) => (await call('GetProduct', { pid })).r?.quantity;

(async () => {
  let x = await call('ListProducts', {});
  check('TC-PRO-01 lấy danh sách (có dữ liệu mẫu)', !x.err && x.r.items.length >= 2, JSON.stringify(x.err?.message));

  x = await call('GetProduct', { pid: 1 });
  check('TC-PRO-02 lấy Product tồn tại', !x.err && x.r.pid === 1 && x.r.pname === 'Laptop', JSON.stringify(x.r || x.err?.message));

  x = await call('GetProduct', { pid: 999999 });
  check('TC-PRO-03 Product không tồn tại -> NOT_FOUND (404)', code(x) === S.NOT_FOUND, code(x));

  x = await call('CreateProduct', { pname: 'Test Item', price: 10, quantity: 5 });
  const pid = x.r?.pid;
  check('TC-PRO-04 tạo Product -> có pid', !x.err && pid > 0 && x.r.quantity === 5, JSON.stringify(x.err?.message));

  x = await call('UpdateProduct', { pid, data: { pname: 'Test Item 2', price: 12, quantity: 20 } });
  check('TC-PRO-05 cập nhật tồn kho chính xác', !x.err && (await qtyOf(pid)) === 20, JSON.stringify(x.err?.message));

  x = await call('UpdateProduct', { pid: 999999, data: { pname: 'A', price: 1, quantity: 1 } });
  check('Cập nhật Product không tồn tại -> NOT_FOUND', code(x) === S.NOT_FOUND, code(x));

  x = await call('CreateProduct', { pname: '', price: 10, quantity: 5 });
  check('Tên rỗng -> INVALID_ARGUMENT (400)', code(x) === S.INVALID_ARGUMENT, code(x));
  x = await call('CreateProduct', { pname: 'X', price: -5, quantity: 5 });
  check('Giá âm -> INVALID_ARGUMENT (400)', code(x) === S.INVALID_ARGUMENT, code(x));
  x = await call('CreateProduct', { pname: 'X', price: 5, quantity: -1 });
  check('Số lượng âm -> INVALID_ARGUMENT (400)', code(x) === S.INVALID_ARGUMENT, code(x));

  // --- Kho hàng ---
  x = await call('ReserveStock', { items: [{ pid, qty: 3 }] });
  check('ReserveStock trừ kho và trả giá', !x.err && x.r.items[0].price === 12 && (await qtyOf(pid)) === 17, JSON.stringify(x.err?.message || x.r));

  x = await call('ReserveStock', { items: [{ pid, qty: 1000 }] });
  check('Không đủ hàng -> ALREADY_EXISTS (409), kho giữ nguyên', code(x) === S.ALREADY_EXISTS && (await qtyOf(pid)) === 17, code(x));

  x = await call('ReserveStock', { items: [{ pid, qty: 2 }, { pid: 999999, qty: 1 }] });
  check('Một dòng không tồn tại -> NOT_FOUND và hoàn lại dòng đã trừ', code(x) === S.NOT_FOUND && (await qtyOf(pid)) === 17, `${code(x)} qty=${await qtyOf(pid)}`);

  x = await call('ReserveStock', { items: [{ pid, qty: 2 }, { pid: 1, qty: 99999 }] });
  check('Dòng sau thiếu hàng -> hoàn lại dòng trước (all-or-nothing)', code(x) === S.ALREADY_EXISTS && (await qtyOf(pid)) === 17, `${code(x)} qty=${await qtyOf(pid)}`);

  x = await call('ReserveStock', { items: [{ pid, qty: 1 }, { pid, qty: 2 }] });
  check('Trùng pid được gộp (1+2=3)', !x.err && (await qtyOf(pid)) === 14, JSON.stringify(x.err?.message));

  x = await call('ReserveStock', { items: [{ pid, qty: 0 }] });
  check('qty = 0 -> INVALID_ARGUMENT', code(x) === S.INVALID_ARGUMENT, code(x));
  x = await call('ReserveStock', { items: [] });
  check('Danh sách rỗng -> INVALID_ARGUMENT', code(x) === S.INVALID_ARGUMENT, code(x));

  x = await call('ReleaseStock', { items: [{ pid, qty: 3 }] });
  check('ReleaseStock hoàn kho', !x.err && (await qtyOf(pid)) === 17, JSON.stringify(x.err?.message));

  // Chống bán quá số lượng: kho 5, 12 người mua 1 cái cùng lúc => đúng 5 người thành công
  await call('UpdateProduct', { pid, data: { pname: 'Test Item 2', price: 12, quantity: 5 } });
  const results = await Promise.all(Array.from({ length: 12 }, () => call('ReserveStock', { items: [{ pid, qty: 1 }] })));
  const ok = results.filter((r) => !r.err).length;
  check('12 yêu cầu đồng thời, kho 5 -> đúng 5 thành công, kho = 0', ok === 5 && (await qtyOf(pid)) === 0, `ok=${ok} qty=${await qtyOf(pid)}`);

  x = await call('DeleteProduct', { pid });
  check('Xóa Product', !x.err && (await call('GetProduct', { pid })).err?.code === S.NOT_FOUND, JSON.stringify(x.err?.message));
  x = await call('DeleteProduct', { pid });
  check('Xóa lại -> NOT_FOUND', code(x) === S.NOT_FOUND, code(x));

  console.log(`\n${passed}/${total} đạt`);
  process.exit(passed === total ? 0 : 1);
})();
