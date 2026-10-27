const { BadRequest } = require('@ecommerce/common');

function validateProductInput({ pname, price, quantity }) {
  const name = (pname || '').trim();
  if (!name) throw BadRequest('pname is required');
  if (name.length > 100) throw BadRequest('pname must be at most 100 characters');
  if (!Number.isFinite(price) || price <= 0) throw BadRequest('price must be greater than 0');
  if (!Number.isInteger(quantity) || quantity < 0) throw BadRequest('quantity must be an integer >= 0');
  return { pname: name, price, quantity };
}

// Gộp các dòng trùng pid, kiểm tra pid và qty hợp lệ
function normalizeItems(items) {
  if (!items || items.length === 0) throw BadRequest('items must not be empty');
  const merged = new Map();
  for (const { pid, qty } of items) {
    if (!Number.isInteger(pid) || pid <= 0) throw BadRequest('invalid pid');
    if (!Number.isInteger(qty) || qty <= 0) throw BadRequest('qty must be an integer > 0');
    merged.set(pid, (merged.get(pid) || 0) + qty);
  }
  return [...merged].map(([pid, qty]) => ({ pid, qty }));
}

module.exports = { validateProductInput, normalizeItems };
