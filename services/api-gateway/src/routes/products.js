const express = require('express');
const config = require('../config');
const { clients, call } = require('../grpc');
const { authenticate, authorize, ah } = require('../middleware');
const { cached, invalidateProducts } = require('../cache');
const { intId, productBody } = require('../validate');

const router = express.Router();
router.use(authenticate);

// API-PRO-01 (có cache Redis, X-Cache: HIT/MISS)
router.get('/', ah(async (req, res) => {
  await cached(res, 'cache:products:list', config.productCacheTtlSec,
    () => call(clients.product, 'ListProducts', {}));
}));

// API-PRO-02
router.get('/:pid', ah(async (req, res) => {
  const pid = intId(req.params.pid);
  await cached(res, `cache:products:${pid}`, config.productCacheTtlSec,
    () => call(clients.product, 'GetProduct', { pid }));
}));

// API-PRO-03 (Admin)
router.post('/', authorize('ADMIN'), ah(async (req, res) => {
  const p = await call(clients.product, 'CreateProduct', productBody(req.body));
  await invalidateProducts();
  res.status(201).json(p);
}));

// API-PRO-04 (Admin)
router.put('/:pid', authorize('ADMIN'), ah(async (req, res) => {
  const pid = intId(req.params.pid);
  await call(clients.product, 'UpdateProduct', { pid, data: productBody(req.body) });
  await invalidateProducts();
  res.json({ message: 'Product updated successfully', pid });
}));

// API-PRO-05 (Admin)
router.delete('/:pid', authorize('ADMIN'), ah(async (req, res) => {
  const pid = intId(req.params.pid);
  await call(clients.product, 'DeleteProduct', { pid });
  await invalidateProducts();
  res.json({ message: 'Product deleted successfully', pid });
}));

module.exports = router;
