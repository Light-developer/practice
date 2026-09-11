import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { query, pool } from './db.js';
import { initializeTransaction, verifyTransaction, verifyWebhookSignature } from './paystack.js';
import vendorRoutes from './vendor-routes.js';
import 'dotenv/config';

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';
const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) console.warn('JWT_SECRET is not configured. Authentication endpoints will fail until it is set.');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: frontendUrl, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));
app.use(cookieParser());

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
const paymentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

function signUser(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, jwtSecret, { expiresIn: '7d' });
}

function setAuthCookie(res, token) {
  res.cookie('solea_session', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

function authRequired(req, res, next) {
  try {
    const token = req.cookies.solea_session;
    if (!token || !jwtSecret) return res.status(401).json({ error: 'Authentication required' });
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function validateEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateOrderNumber() {
  return `SO-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

// Paystack requires the raw request body for HMAC-SHA512 webhook verification.
app.post('/api/payments/paystack/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const raw = req.body;
  if (!verifyWebhookSignature(raw, req.headers['x-paystack-signature'])) return res.sendStatus(401);
  res.sendStatus(200);

  try {
    const event = JSON.parse(raw.toString('utf8'));
    if (event.event !== 'charge.success') return;
    const payment = event.data;
    const reference = payment.reference;
    const result = await query('SELECT id, total_kobo, status FROM orders WHERE payment_reference = $1', [reference]);
    const order = result.rows[0];
    if (!order || order.status === 'paid') return;
    if (Number(payment.amount) !== Number(order.total_kobo) || payment.status !== 'success') return;
    await query("UPDATE orders SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = $1 AND status <> 'paid'", [order.id]);
  } catch (error) {
    console.error('Paystack webhook processing failed:', error);
  }
});

app.use(express.json({ limit: '100kb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, service: 'solea-api', database: 'connected' });
  } catch {
    res.status(503).json({ ok: false, service: 'solea-api', database: 'unavailable' });
  }
});

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  try {
    const { email, password, fullName } = req.body;
    if (!validateEmail(email) || typeof password !== 'string' || password.length < 10 || typeof fullName !== 'string' || fullName.trim().length < 2) {
      return res.status(400).json({ error: 'Provide a valid name, email and password of at least 10 characters.' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query('INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id, email, full_name, role', [email.trim().toLowerCase(), passwordHash, fullName.trim()]);
    const user = result.rows[0];
    setAuthCookie(res, signUser(user));
    res.status(201).json({ user });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account with that email already exists.' });
    next(error);
  }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!validateEmail(email) || typeof password !== 'string') return res.status(400).json({ error: 'Invalid login details.' });
    const result = await query('SELECT id, email, full_name, role, password_hash FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid email or password.' });
    delete user.password_hash;
    setAuthCookie(res, signUser(user));
    res.json({ user });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('solea_session', { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
  res.status(204).end();
});

app.get('/api/auth/me', authRequired, async (req, res, next) => {
  try {
    const result = await query('SELECT id, email, full_name, role, created_at FROM users WHERE id = $1', [req.user.sub]);
    if (!result.rows[0]) return res.status(401).json({ error: 'Account no longer exists.' });
    res.json({ user: result.rows[0] });
  } catch (error) { next(error); }
});

app.use('/api/vendors', vendorRoutes);

app.get('/api/products', async (req, res, next) => {
  try {
    const values = [];
    const filters = ['active = TRUE'];
    if (req.query.brand) { values.push(req.query.brand); filters.push(`brand = $${values.length}`); }
    if (req.query.category) { values.push(req.query.category); filters.push(`category = $${values.length}`); }
    if (req.query.search) { values.push(`%${String(req.query.search).trim()}%`); filters.push(`(name ILIKE $${values.length} OR brand ILIKE $${values.length} OR category ILIKE $${values.length})`); }
    const result = await query(`SELECT id, legacy_id, name, brand, category, description, price_kobo, currency, image_url, badge, stock FROM products WHERE ${filters.join(' AND ')} ORDER BY created_at DESC`, values);
    res.json({ products: result.rows });
  } catch (error) { next(error); }
});

app.get('/api/products/:id', async (req, res, next) => {
  try {
    const result = await query('SELECT id, legacy_id, name, brand, category, description, price_kobo, currency, image_url, badge, stock FROM products WHERE id = $1 AND active = TRUE', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product: result.rows[0] });
  } catch (error) { next(error); }
});

app.post('/api/orders/initialize-payment', paymentLimiter, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { email, fullName, deliveryAddress, items } = req.body;
    if (!validateEmail(email) || typeof fullName !== 'string' || fullName.trim().length < 2 || typeof deliveryAddress !== 'string' || deliveryAddress.trim().length < 5 || !Array.isArray(items) || items.length === 0 || items.length > 50) {
      return res.status(400).json({ error: 'Please provide valid customer and order details.' });
    }

    await client.query('BEGIN');
    const normalized = items.map(item => ({ legacyId: Number(item.legacyId), quantity: Number(item.quantity) })).filter(item => Number.isInteger(item.legacyId) && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 20);
    if (!normalized.length || normalized.length !== items.length) throw new Error('Invalid cart items.');

    const legacyIds = normalized.map(item => item.legacyId);
    const products = await client.query('SELECT id, legacy_id, name, brand, price_kobo, currency, stock, vendor_id FROM products WHERE legacy_id = ANY($1::int[]) AND active = TRUE FOR UPDATE', [legacyIds]);
    const byLegacy = new Map(products.rows.map(p => [p.legacy_id, p]));
    if (byLegacy.size !== normalized.length) throw new Error('One or more products are unavailable.');

    let subtotal = 0;
    const orderItems = [];
    for (const item of normalized) {
      const product = byLegacy.get(item.legacyId);
      if (product.stock < item.quantity) throw new Error(`${product.name} does not have enough stock.`);
      const lineTotal = Number(product.price_kobo) * item.quantity;
      subtotal += lineTotal;
      orderItems.push({ product, quantity: item.quantity, lineTotal });
    }

    const shipping = subtotal >= 15000000 ? 0 : 1800000;
    const total = subtotal + shipping;
    const orderNumber = generateOrderNumber();
    const reference = `SOLEA-${crypto.randomBytes(10).toString('hex')}`;
    const order = await client.query(`INSERT INTO orders (order_number, user_id, email, full_name, delivery_address, subtotal_kobo, shipping_kobo, total_kobo, currency, payment_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, order_number, total_kobo, currency, payment_reference`, [orderNumber, req.user?.sub || null, email.trim().toLowerCase(), fullName.trim(), deliveryAddress.trim(), subtotal, shipping, total, process.env.PAYSTACK_CURRENCY || 'NGN', reference]);

    for (const item of orderItems) {
      await client.query(`INSERT INTO order_items (order_id, product_id, vendor_id, product_name, brand, unit_price_kobo, quantity, line_total_kobo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [order.rows[0].id, item.product.id, item.product.vendor_id, item.product.name, item.product.brand, item.product.price_kobo, item.quantity, item.lineTotal]);
    }

    await client.query('COMMIT');
    const payment = await initializeTransaction({
      email: email.trim().toLowerCase(),
      amount: total,
      reference,
      callbackUrl: `${frontendUrl}/checkout.html`,
      metadata: { order_id: order.rows[0].id, order_number: orderNumber }
    });
    res.status(201).json({ order: order.rows[0], payment });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: error.message || 'Unable to create order.' });
  } finally { client.release(); }
});

app.get('/api/orders/verify/:reference', paymentLimiter, async (req, res, next) => {
  try {
    const payment = await verifyTransaction(req.params.reference);
    const result = await query('SELECT id, order_number, total_kobo, currency, status FROM orders WHERE payment_reference = $1', [req.params.reference]);
    const order = result.rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (payment.status === 'success' && Number(payment.amount) === Number(order.total_kobo)) {
      await query("UPDATE orders SET status = 'paid', paid_at = COALESCE(paid_at, NOW()), updated_at = NOW() WHERE id = $1 AND status <> 'paid'", [order.id]);
    }
    res.json({ payment: { status: payment.status, reference: payment.reference, amount: payment.amount }, order: { ...order, status: payment.status === 'success' ? 'paid' : order.status } });
  } catch (error) { next(error); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

export default app;
