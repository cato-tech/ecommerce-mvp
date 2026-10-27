const { NotFound, Conflict, BadRequest, toGrpcError, createLogger } = require('@ecommerce/common');
const { products, nextPid } = require('./db');
const { validateProductInput, normalizeItems } = require('./validate');

const log = createLogger('product-service');
const PROJECTION = { _id: 0, pid: 1, pname: 1, price: 1, quantity: 1 };

// Chỉ trả các trường công khai (lọc trong code để không phụ thuộc projection của findAndModify)
const pick = (d) => d && { pid: d.pid, pname: d.pname, price: d.price, quantity: d.quantity };

const wrap = (fn) => async (call, callback) => {
  try {
    callback(null, await fn(call.request));
  } catch (err) {
    callback(toGrpcError(err));
  }
};

async function insertProduct(input) {
  const data = validateProductInput(input);
  const pid = await nextPid();
  const now = new Date();
  await products().insertOne({ pid, ...data, created_at: now, updated_at: now });
  return { pid, ...data };
}

const ListProducts = wrap(async () => {
  const items = await products().find({}, { projection: PROJECTION }).sort({ pid: 1 }).toArray();
  return { items };
});

const GetProduct = wrap(async ({ pid }) => {
  const p = await products().findOne({ pid }, { projection: PROJECTION });
  if (!p) throw NotFound('Product not found');
  return p;
});

const CreateProduct = wrap(async (req) => insertProduct(req));

const UpdateProduct = wrap(async ({ pid, data }) => {
  const input = validateProductInput(data || {});
  const r = await products().findOneAndUpdate(
    { pid },
    { $set: { ...input, updated_at: new Date() } },
    { returnDocument: 'after' }
  );
  if (!r) throw NotFound('Product not found');
  return pick(r);
});

const DeleteProduct = wrap(async ({ pid }) => {
  const r = await products().deleteOne({ pid });
  if (!r.deletedCount) throw NotFound('Product not found');
  return { pid };
});

// Trừ kho: mỗi sản phẩm là MỘT lệnh nguyên tử có điều kiện (quantity >= qty),
// nên hai người mua cùng lúc không thể làm kho âm.
// Nếu một dòng thất bại thì hoàn lại các dòng đã trừ (bù trừ).
const ReserveStock = wrap(async ({ items }) => {
  const wanted = normalizeItems(items);
  const reserved = [];
  const result = [];
  try {
    for (const { pid, qty } of wanted) {
      const after = await products().findOneAndUpdate(
        { pid, quantity: { $gte: qty } },
        { $inc: { quantity: -qty }, $set: { updated_at: new Date() } },
        { returnDocument: 'after' }
      );
      if (!after) {
        // Phân biệt: không có sản phẩm (404) hay không đủ hàng (409)
        const exists = await products().findOne({ pid }, { projection: { _id: 1 } });
        if (!exists) throw NotFound(`Product ${pid} not found`);
        throw Conflict(`Insufficient stock for product ${pid}`);
      }
      reserved.push({ pid, qty });
      result.push(pick(after)); // giá hiện tại để Order lưu unit_price; quantity = số còn lại
    }
    return { items: result };
  } catch (err) {
    await restore(reserved);
    throw err;
  }
});

async function restore(list) {
  for (const { pid, qty } of list) {
    try {
      await products().updateOne({ pid }, { $inc: { quantity: qty }, $set: { updated_at: new Date() } });
    } catch (e) {
      log.error('restore stock failed', { pid, qty, error: e.message });
    }
  }
}

// Hoàn kho (bù trừ khi Order thất bại). Sản phẩm đã bị xóa thì bỏ qua, không báo lỗi.
const ReleaseStock = wrap(async ({ items }) => {
  const list = normalizeItems(items);
  const result = [];
  for (const { pid, qty } of list) {
    const after = await products().findOneAndUpdate(
      { pid },
      { $inc: { quantity: qty }, $set: { updated_at: new Date() } },
      { returnDocument: 'after' }
    );
    if (after) result.push(pick(after));
  }
  return { items: result };
});

// Dữ liệu mẫu khi bảng trống (khớp ví dụ trong API Spec)
async function seed() {
  if ((await products().countDocuments()) > 0) return;
  await insertProduct({ pname: 'Laptop', price: 1500, quantity: 10 });
  await insertProduct({ pname: 'Mouse', price: 25, quantity: 100 });
  log.info('seeded sample products');
}

module.exports = {
  ListProducts, GetProduct, CreateProduct, UpdateProduct, DeleteProduct,
  ReserveStock, ReleaseStock, seed,
};
