const express = require('express');
const { BadRequest, NotFound } = require('@ecommerce/common');
const { grpc } = require('@ecommerce/common');
const { clients, call } = require('../grpc');
const { authenticate, authorize, ah } = require('../middleware');
const { intId, isObj } = require('../validate');

const router = express.Router();
router.use(authenticate);

// API-SHP-01: khách chỉ xem vận đơn của đơn hàng thuộc về mình
router.get('/:shipid', ah(async (req, res) => {
  const shipid = intId(req.params.shipid);
  const shipment = await call(clients.shipment, 'GetShipment', { shipid });
  if (req.user.role === 'CUSTOMER') {
    try {
      await call(clients.order, 'GetOrder', { oid: shipment.oid, uid: req.user.uid, role: req.user.role });
    } catch (err) {
      // Không phải đơn của mình: trả 404 để không lộ vận đơn có tồn tại hay không
      if (err.code === grpc.status.NOT_FOUND || err.code === grpc.status.PERMISSION_DENIED) {
        throw NotFound('Shipment not found');
      }
      throw err;
    }
  }
  res.json(shipment);
}));

// API-SHP-02: Shipment Staff hoặc Admin
router.patch('/:shipid/status', authorize('SHIPMENT_STAFF', 'ADMIN'), ah(async (req, res) => {
  const shipid = intId(req.params.shipid);
  if (!isObj(req.body) || typeof req.body.status !== 'string') throw BadRequest('status (string) is required');
  res.json(await call(clients.shipment, 'UpdateShipmentStatus', { shipid, status: req.body.status }));
}));

module.exports = router;
