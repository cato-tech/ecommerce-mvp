const { BadRequest } = require('@ecommerce/common');

// Chỉ nhận số nguyên dương dạng chữ số ("1e2", "1abc", "-1" bị từ chối)
function intId(v) {
  if (!/^\d{1,9}$/.test(String(v)) || Number(v) <= 0) throw BadRequest('invalid id');
  return Number(v);
}

function shipId(v) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(v))) throw BadRequest('invalid shipment id');
  return String(v);
}

const isObj = (b) => b && typeof b === 'object' && !Array.isArray(b);

function orderItems(body) {
  const items = isObj(body) ? body.items : undefined;
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    throw BadRequest('items must be an array of 1-50 entries');
  }
  return items.map((it) => {
    if (!isObj(it) || !Number.isInteger(it.pid) || it.pid <= 0 || !Number.isInteger(it.qty) || it.qty <= 0) {
      throw BadRequest('each item needs integer pid > 0 and qty > 0');
    }
    return { pid: it.pid, qty: it.qty };
  });
}

function productBody(body) {
  if (!isObj(body) || typeof body.pname !== 'string' || typeof body.price !== 'number' || typeof body.quantity !== 'number') {
    throw BadRequest('pname (string), price (number) and quantity (number) are required');
  }
  return { pname: body.pname, price: body.price, quantity: body.quantity };
}

module.exports = { intId, shipId, isObj, orderItems, productBody };
