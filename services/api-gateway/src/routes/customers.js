const express = require('express');
const { BadRequest, Forbidden } = require('@ecommerce/common');
const { clients, call } = require('../grpc');
const { authenticate, ah } = require('../middleware');
const { intId, isObj } = require('../validate');

const router = express.Router();
router.use(authenticate);

// Khách chỉ truy cập hồ sơ của chính mình; Admin truy cập được tất cả
function assertOwnerOrAdmin(req, uid) {
  if (req.user.role !== 'ADMIN' && req.user.uid !== uid) {
    throw Forbidden('You can only access your own profile');
  }
}

// API-CUS-01
router.get('/:uid', ah(async (req, res) => {
  const uid = intId(req.params.uid);
  assertOwnerOrAdmin(req, uid);
  res.json(await call(clients.customer, 'GetCustomer', { uid }));
}));

// API-CUS-02 (đổi hạng thành viên `mid` do Customer Service giới hạn cho Admin)
router.put('/:uid', ah(async (req, res) => {
  const uid = intId(req.params.uid);
  assertOwnerOrAdmin(req, uid);
  const b = req.body;
  if (!isObj(b) || (b.fullname !== undefined && typeof b.fullname !== 'string') ||
      (b.mid !== undefined && !Number.isInteger(b.mid))) {
    throw BadRequest('fullname must be a string and mid an integer');
  }
  await call(clients.customer, 'UpdateCustomer', {
    uid, fullname: b.fullname || '', mid: b.mid || 0,
    caller_uid: req.user.uid, caller_role: req.user.role,
  });
  res.json({ message: 'Customer updated successfully', uid });
}));

module.exports = router;
