const express = require('express');
const { BadRequest } = require('@ecommerce/common');
const config = require('../config');
const { clients, call } = require('../grpc');
const { rateLimit, ah } = require('../middleware');
const { isObj } = require('../validate');

const router = express.Router();

const str = (v) => (typeof v === 'string' ? v : undefined);

// API-AUTH-01
router.post('/register', rateLimit('register', config.rate.register), ah(async (req, res) => {
  if (!isObj(req.body)) throw BadRequest('JSON body required');
  const { username, password, email, phone } = req.body;
  if (str(username) === undefined || str(password) === undefined || str(email) === undefined ||
      (phone !== undefined && str(phone) === undefined)) {
    throw BadRequest('username, password and email must be strings');
  }
  const r = await call(clients.auth, 'Register', { username, password, email, phone: phone || '' });
  res.status(201).json({ message: 'User registered successfully', uid: r.uid });
}));

// API-AUTH-02
router.post('/login', rateLimit('login', config.rate.login), ah(async (req, res) => {
  if (!isObj(req.body)) throw BadRequest('JSON body required');
  const { username, password } = req.body;
  if (str(username) === undefined || str(password) === undefined) {
    throw BadRequest('username and password are required');
  }
  const r = await call(clients.auth, 'Login', { username, password });
  res.json({ accessToken: r.access_token, tokenType: 'Bearer', expiresIn: r.expires_in });
}));

module.exports = router;
