const express = require('express');
const helmet = require('helmet');
const config = require('./config');
const { requestLogger, rateLimit, errorHandler } = require('./middleware');

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(requestLogger);
app.use(express.json({ limit: '100kb' }));
app.use('/api', rateLimit('general', config.rate.general));

app.use('/api/health', require('./routes/health'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/shipments', require('./routes/shipments'));

app.use((req, res) => res.status(404).json({ status: 404, message: 'Route not found' }));
app.use(errorHandler);

module.exports = app;
