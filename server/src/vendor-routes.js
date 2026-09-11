import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, pool } from './db.js';

const router = express.Router();
const jwtSecret = process.env.JWT_SECRET;

function authRequired(req, res, next) {
  try {
    const token = req.cookies.solea_session;
    if (!token || !jwtSecret) return res.status(401).json({ error: 'Authentication required.' });
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

function vendorRequired(req, res, next) {
  if (req.user?.role !== 'vendor') return res.status(403).json({ error: 'Vendor access required.' });
  next();
}

function validateEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateProductInput(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const brand = typeof body.brand === 'string' ? body.brand.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const price = Number(body.price);
  const stock = Number(body.stock);
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
  const badge = typeof body.badge === 'string' ? body.badge.trim() : '';

  if (name.length < 2 || name.length > 160) throw new Error('Product name must be between 2 and 160 characters.');
  if (brand.length < 2 || brand.length > 100) throw new Error('Brand name is required.');
  if (category.length < 2 || category.length > 100) throw new Error('Category is required.');
  if (!Number.isFinite(price) || price <= 0 || price > 1000000) throw new Error('Enter a valid product price.');
  if (!Number.isInteger(stock) || stock < 0 || stock > 1000000) throw new Error('Enter a valid stock quantity.');
  if (!imageUrl || imageUrl.length > 1000) throw new Error('A product image URL is required.');
  if (description.length > 5000) throw new Error('Description is too long.');

  return {
    name,
    brand,
    category,
    description,
    priceKobo: Math.round(price * 100),
    stock,
    imageUrl,
    badge: badge || null
  };
}

router.post('/register', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { brand, email, password, country, story } = req.body;
    if (typeof brand !== 'string' || brand.trim().length < 2 || brand.trim().length > 160 || !validateEmail(email) || typeof password !== 'string' || password.length < 10 || typeof country !== 'string' || country.trim().length < 2) {
      return res.status(400).json({ error: 'Provide a valid brand, email, country and password of at least 10 characters.' });
    }

    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (existing.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userResult = await client.query(
      'INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, \'vendor\') RETURNING id, email, full_name, role',
      [email.trim().toLowerCase(), passwordHash, brand.trim()]
    );
    const user = userResult.rows[0];
    await client.query(
      'INSERT INTO vendors (user_id, brand_name, country, story, status) VALUES ($1, $2, $3, $4, \'pending\')',
      [user.id, brand.trim(), country.trim(), typeof story === 'string' ? story.trim() : null]
    );
    await client.query('COMMIT');

    const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, jwtSecret, { expiresIn: '7d' });
    res.cookie('solea_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });
    res.status(201).json({ user, vendor: { brand_name: brand.trim(), country: country.trim(), status: 'pending' } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ error: 'An account with that email or brand already exists.' });
    next(error);
  } finally {
    client.release();
  }
});

router.get('/me', authRequired, vendorRequired, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT u.id, u.email, u.full_name, u.created_at,
             v.brand_name, v.country, v.story, v.status, v.paystack_subaccount_code
      FROM users u
      JOIN vendors v ON v.user_id = u.id
      WHERE u.id = $1
    `, [req.user.sub]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Vendor profile not found.' });
    res.json({ vendor: result.rows[0] });
  } catch (error) { next(error); }
});

router.get('/dashboard', authRequired, vendorRequired, async (req, res, next) => {
  try {
    const vendorResult = await query(`
      SELECT v.id, v.brand_name, v.country, v.story, v.status, u.email
      FROM vendors v JOIN users u ON u.id = v.user_id
      WHERE v.user_id = $1
    `, [req.user.sub]);
    const vendor = vendorResult.rows[0];
    if (!vendor) return res.status(404).json({ error: 'Vendor profile not found.' });

    const [salesResult, ordersResult, unitsResult, stockResult] = await Promise.all([
      query(`SELECT COALESCE(SUM(oi.line_total_kobo), 0) AS gross_sales
             FROM order_items oi JOIN orders o ON o.id = oi.order_id
             WHERE oi.vendor_id = $1 AND o.status IN ('paid','processing','shipped','delivered')`, [vendor.id]),
      query(`SELECT COUNT(DISTINCT o.id) AS orders
             FROM order_items oi JOIN orders o ON o.id = oi.order_id
             WHERE oi.vendor_id = $1 AND o.status IN ('paid','processing','shipped','delivered')`, [vendor.id]),
      query(`SELECT COALESCE(SUM(oi.quantity), 0) AS units_sold
             FROM order_items oi JOIN orders o ON o.id = oi.order_id
             WHERE oi.vendor_id = $1 AND o.status IN ('paid','processing','shipped','delivered')`, [vendor.id]),
      query(`SELECT COALESCE(SUM(stock), 0) AS available_stock
             FROM products WHERE vendor_id = $1 AND active = TRUE`, [vendor.id])
    ]);

    const productsResult = await query(`
      SELECT id, name, brand, category, price_kobo, currency, stock, active, badge, image_url, created_at
      FROM products WHERE vendor_id = $1 ORDER BY created_at DESC
    `, [vendor.id]);

    const recentOrdersResult = await query(`
      SELECT o.id, o.order_number, o.full_name, o.delivery_address, o.status, o.created_at,
             SUM(oi.line_total_kobo) AS vendor_total,
             json_agg(json_build_object('name', oi.product_name, 'quantity', oi.quantity)) AS items
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE oi.vendor_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 10
    `, [vendor.id]);

    res.json({
      vendor,
      metrics: {
        gross_sales: salesResult.rows[0].gross_sales,
        orders: ordersResult.rows[0].orders,
        units_sold: unitsResult.rows[0].units_sold,
        available_stock: stockResult.rows[0].available_stock
      },
      products: productsResult.rows,
      orders: recentOrdersResult.rows
    });
  } catch (error) { next(error); }
});

router.post('/products', authRequired, vendorRequired, async (req, res, next) => {
  try {
    const vendorResult = await query('SELECT id, brand_name, status FROM vendors WHERE user_id = $1', [req.user.sub]);
    const vendor = vendorResult.rows[0];
    if (!vendor) return res.status(404).json({ error: 'Vendor profile not found.' });
    const product = validateProductInput({ ...req.body, brand: vendor.brand_name });
    const result = await query(`
      INSERT INTO products (vendor_id, name, brand, category, description, price_kobo, currency, image_url, badge, stock, active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id, name, brand, category, description, price_kobo, currency, image_url, badge, stock, active
    `, [vendor.id, product.name, product.brand, product.category, product.description || null, product.priceKobo, process.env.PAYSTACK_CURRENCY || 'USD', product.imageUrl, product.badge, product.stock, vendor.status === 'approved']);
    res.status(201).json({ product: result.rows[0] });
  } catch (error) {
    if (error.message?.startsWith('Product ') || error.message?.startsWith('Brand ') || error.message?.startsWith('Category ') || error.message?.startsWith('Enter ') || error.message?.includes('Description') || error.message?.includes('image')) return res.status(400).json({ error: error.message });
    next(error);
  }
});

router.patch('/products/:id', authRequired, vendorRequired, async (req, res, next) => {
  try {
    const vendorResult = await query('SELECT id, brand_name FROM vendors WHERE user_id = $1', [req.user.sub]);
    const vendor = vendorResult.rows[0];
    if (!vendor) return res.status(404).json({ error: 'Vendor profile not found.' });
    const product = validateProductInput({ ...req.body, brand: vendor.brand_name });
    const result = await query(`
      UPDATE products
      SET name=$1, brand=$2, category=$3, description=$4, price_kobo=$5, image_url=$6, badge=$7, stock=$8, updated_at=NOW()
      WHERE id=$9 AND vendor_id=$10
      RETURNING id, name, brand, category, description, price_kobo, currency, image_url, badge, stock, active
    `, [product.name, product.brand, product.category, product.description || null, product.priceKobo, product.imageUrl, product.badge, product.stock, req.params.id, vendor.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product: result.rows[0] });
  } catch (error) { next(error); }
});

router.delete('/products/:id', authRequired, vendorRequired, async (req, res, next) => {
  try {
    const vendorResult = await query('SELECT id FROM vendors WHERE user_id = $1', [req.user.sub]);
    const vendor = vendorResult.rows[0];
    if (!vendor) return res.status(404).json({ error: 'Vendor profile not found.' });
    const result = await query('UPDATE products SET active = FALSE, updated_at = NOW() WHERE id = $1 AND vendor_id = $2 RETURNING id', [req.params.id, vendor.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Product not found.' });
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;
