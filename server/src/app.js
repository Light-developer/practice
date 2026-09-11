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

// During local development, allow both common Live Server origins. Production stays locked to FRONTEND_URL.
const developmentOrigins = new Set([
  frontendUrl,
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:5501',
  'http://127.0.0.1:5501'
]);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || (!isProduction && developmentOrigins.has(origin)) || (isProduction && origin === frontendUrl)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
}));

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

function authOptional(req, _res, next) {
  try {
    const token = req.cookies.solea_session;
    if (token && jwtSecret) req.user = jwt.verify(token, jwtSecret);
  } catch {
    // An invalid optional session is treated as an anonymous customer.
  }
  next();
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
    const reference = event.data?.reference;
    if (!reference) return;
    await query(`UPDATE orders SET status = 'paid', paid_at = COALESCE(paid_at, NOW()) WHERE payment_reference = $1 AND status = 'pending_payment'`, [reference]);
  } catch (error) {
    console.error('Paystack webhook processing failed:', error);
  }
});

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'solea-api' }));

app.post('/api/auth/register', authLimiter, async (req, res) => {
  if (!jwtSecret) return res.status(503).json({ error: 'Authentication is not configured on the server.' });
  const { email, password, fullName = '' } = req.body || {};
  if (!validateEmail(email) || typeof password !== 'string' || password.length < 10) {
    return res.status(400).json({ error: 'Provide a valid email and a password of at least 10 characters.' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, 'customer') RETURNING id, email, full_name, role`, [email.trim().toLowerCase(), passwordHash, String(fullName).trim()]);
    const user = result.rows[0];
    setAuthCookie(res, signUser(user));
    res.status(201).json({ user });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account with that email already exists.' });
    console.error(error);
    res.status(500).json({ error: 'Unable to create account.' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  if (!jwtSecret) return res.status(503).json({ error: 'Authentication is not configured on the server.' });
  const { email, password } = req.body || {};
  if (!validateEmail(email) || typeof password !== 'string') return res.status(400).json({ error: 'Email and password are required.' });
  try {
    const result = await query(`SELECT id, email, password_hash, full_name, role FROM users WHERE email = $1 LIMIT 1`, [email.trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid email or password.' });
    const publicUser = { id: user.id, email: user.email, full_name: user.full_name, role: user.role };
    setAuthCookie(res, signUser(publicUser));
    res.json({ user: publicUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to sign in.' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('solea_session', { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
  res.status(204).end();
});

app.get('/api/auth/me', authRequired, async (req, res) => {
  const result = await query(`SELECT id, email, full_name, role FROM users WHERE id = $1`, [req.user.sub]);
  if (!result.rows[0]) return res.status(401).json({ error: 'Account not found.' });
  res.json({ user: result.rows[0] });
});

app.use('/api/vendors', vendorRoutes);

app.get('/api/products', async (_req, res) => {
  const result = await query(`SELECT id, name, brand, category, description, price_kobo, currency, image_url, badge, stock, active FROM products WHERE active = true ORDER BY created_at DESC`);
  res.json({ products: result.rows });
});

app.get('/api/products/:id', async (req, res) => {
  const result = await query(`SELECT id, name, brand, category, description, price_kobo, currency, image_url, badge, stock, active FROM products WHERE id = $1 AND active = true`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Product not found.' });
  res.json({ product: result.rows[0] });
});

app.post('/api/orders/initialize-payment', paymentLimiter, async (req, res) => {
  const { email, fullName = '', deliveryAddress = '', items = [] } = req.body || {};
  if (!validateEmail(email) || !Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Valid customer details and at least one item are required.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = items.map(item => Number(item.id)).filter(Number.isInteger);
    const productsResult = await client.query(`SELECT id, name, brand, vendor_id, price_kobo, currency, stock, active FROM products WHERE id = ANY($1::bigint[]) FOR UPDATE`, [ids]);
    const productMap = new Map(productsResult.rows.map(product => [Number(product.id), product]));
    const normalized = items.map(item => {
      const product = productMap.get(Number(item.id));
      const quantity = Math.max(1, Math.floor(Number(item.quantity || item.qty || 1)));
      if (!product || !product.active || product.stock < quantity) throw new Error(`Product ${item.id} is unavailable or out of stock.`);
      return { product, quantity, lineTotal: Number(product.price_kobo) * quantity };
    });
    const subtotal = normalized.reduce((sum, item) => sum + item.lineTotal, 0);
    const shipping = subtotal >= 15000 ? 0 : 1800;
    const total = subtotal + shipping;
    const orderNumber = generateOrderNumber();
    const order = await client.query(`INSERT INTO orders (order_number, email, full_name, delivery_address, subtotal_kobo, shipping_kobo, total_kobo, currency, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'USD','pending_payment') RETURNING id, order_number, total_kobo, currency`, [orderNumber, email.trim().toLowerCase(), String(fullName).trim(), String(deliveryAddress).trim(), subtotal, shipping, total]);
    for (const item of normalized) await client.query(`INSERT INTO order_items (order_id, product_id, vendor_id, product_name, brand, unit_price_kobo, quantity, line_total_kobo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [order.rows[0].id, item.product.id, item.product.vendor_id, item.product.name, item.product.brand, item.product.price_kobo, item.quantity, item.lineTotal]);
    const payment = await initializeTransaction({ email: email.trim().toLowerCase(), amount: total, reference: orderNumber, callbackUrl: req.body.callbackUrl });
    await client.query(`UPDATE orders SET payment_reference = $1 WHERE id = $2`, [payment.reference, order.rows[0].id]);
    await client.query('COMMIT');
    res.status(201).json({ authorization_url: payment.authorization_url, access_code: payment.access_code, reference: payment.reference, order: order.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(400).json({ error: error.message || 'Unable to initialize payment.' });
  } finally {
    client.release();
  }
});

app.get('/api/orders/verify/:reference', paymentLimiter, async (req, res) => {
  try {
    const payment = await verifyTransaction(req.params.reference);
    if (payment.status !== 'success') return res.status(400).json({ error: 'Payment has not been completed.' });
    const result = await query(`UPDATE orders SET status = 'paid', paid_at = COALESCE(paid_at, NOW()) WHERE payment_reference = $1 AND status = 'pending_payment' RETURNING id, order_number, status, total_kobo, currency`, [req.params.reference]);
    if (!result.rows[0]) {
      const existing = await query(`SELECT id, order_number, status, total_kobo, currency FROM orders WHERE payment_reference = $1 LIMIT 1`, [req.params.reference]);
      return res.json({ order: existing.rows[0] || null });
    }
    res.json({ order: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: 'Unable to verify payment.' });
  }
});

app.use((error, _req, res, _next) => {
  if (error?.message?.startsWith('CORS blocked origin:')) return res.status(403).json({ error: error.message });
  console.error(error);
  res.status(500).json({ error: 'Internal server error.' });
});

export { app };
