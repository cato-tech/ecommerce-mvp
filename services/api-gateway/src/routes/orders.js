const express = require('express');
const config = require('../config');
const { clients, call } = require('../grpc');
const { authenticate, authorize, ah } = require('../middleware');
const { invalidateProducts } = require('../cache');
const { intId, orderItems } = require('../validate');

const router = express.Router();
router.use(authenticate);

// API-ORD-01: chỉ khách hàng đặt hàng (uid lấy từ JWT, không nhận từ body)
router.post('/', authorize('CUSTOMER'), ah(async (req, res) => {
  const items = orderItems(req.body);
  const order = await call(clients.order, 'CreateOrder', { uid: req.user.uid, items }, config.orderTimeoutMs);
  await invalidateProducts(); // tồn kho đã đổi, bỏ cache sản phẩm
  res.status(201).json(order);
}));

// API-ORD-02: Customer thấy đơn của mình, Admin thấy rộng hơn (Order Service quyết định)
router.get('/', ah(async (req, res) => {
  res.json(await call(clients.order, 'ListOrders', { uid: req.user.uid, role: req.user.role }));
}));

// API-ORD-03
router.get('/:oid', ah(async (req, res) => {
  const oid = intId(req.params.oid);
  res.json(await call(clients.order, 'GetOrder', { oid, uid: req.user.uid, role: req.user.role }));
}));

// Bổ sung ngoài Spec: khách xem vận đơn của đơn hàng mình (response đặt hàng không có shipid vì Shipment tạo bất đồng bộ)
// Khách: phải là chủ đơn (Order Service trả 403/404). Admin và Shipment Staff: xem được mọi đơn.
router.get('/:oid/shipment', ah(async (req, res) => {
  const oid = intId(req.params.oid);
  if (req.user.role === 'CUSTOMER') {
    await call(clients.order, 'GetOrder', { oid, uid: req.user.uid, role: req.user.role });
  }
  res.json(await call(clients.shipment, 'GetShipmentByOrder', { oid }));
}));

module.exports = router;
