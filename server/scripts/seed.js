import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { pool } from '../src/db.js';

const products = [
  [1,'Forum Low','Axel Arigato','Sneakers',28500,'https://images.unsplash.com/photo-1608231387042-66d1773070a5?auto=format&fit=crop&w=900&q=90','Bestseller'],
  [2,'Cloud 5','On','Performance',16000,'https://images.unsplash.com/photo-1551107696-a4b0c5a0d9a2?auto=format&fit=crop&w=900&q=90','New'],
  [3,'Campo','Veja','Sneakers',17500,'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=900&q=90',null],
  [4,'Original Achilles','Common Projects','Luxury',49500,'https://images.unsplash.com/photo-1495555961986-6d4c1ecb7be3?auto=format&fit=crop&w=900&q=90','Icon'],
  [5,'Clean 90','Axel Arigato','Sneakers',29500,'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=90',null],
  [6,'990v6','New Balance','Performance',21000,'https://images.unsplash.com/photo-1539185441755-769473a23570?auto=format&fit=crop&w=900&q=90','New'],
  [7,'Esplar','Veja','Sneakers',14500,'https://images.unsplash.com/photo-1595341888016-a392ef81b7de?auto=format&fit=crop&w=900&q=90',null],
  [8,'Super-Star','Golden Goose','Luxury',62000,'https://images.unsplash.com/photo-1552346154-21d32810aba3?auto=format&fit=crop&w=900&q=90','Limited'],
  [9,'Tatum 1','Jordan','Performance',14500,'https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?auto=format&fit=crop&w=900&q=90',null],
  [10,'Bradley Woven','Norda','Performance',22000,'https://images.unsplash.com/photo-1554130846-a1be9f6e7a80?auto=format&fit=crop&w=900&q=90','Limited'],
  [11,'Retro Runner','Autry','Sneakers',19000,'https://images.unsplash.com/photo-1460353581641-37baddab0fa2?auto=format&fit=crop&w=900&q=90',null],
  [12,'Chelsea Boot','Aeyde','Luxury',43000,'https://images.unsplash.com/photo-1638247025967-b4e38f787b76?auto=format&fit=crop&w=900&q=90','New']
];

const demoVendor = {
  email: 'demo.vendor@solea.test',
  brand: 'Atelier North',
  country: 'Nigeria',
  story: 'A demo footwear house used to validate the SOLEA partner dashboard and marketplace workflow.'
};

const demoOrders = [
  {
    number: 'SO-Demo-1001',
    email: 'customer.one@example.com',
    name: 'Amara Okafor',
    address: '12 Marina Road, Lagos, Nigeria',
    status: 'paid',
    items: [[1, 1]]
  },
  {
    number: 'SO-Demo-1002',
    email: 'customer.two@example.com',
    name: 'Daniel Adeyemi',
    address: '8 Admiralty Way, Lagos, Nigeria',
    status: 'processing',
    items: [[2, 2], [3, 1]]
  },
  {
    number: 'SO-Demo-1003',
    email: 'customer.three@example.com',
    name: 'Maya Williams',
    address: '24 King Street, London, UK',
    status: 'pending_payment',
    items: [[4, 1]]
  }
];

const client = await pool.connect();
const demoPassword = crypto.randomBytes(12).toString('base64url');

try {
  await client.query('BEGIN');

  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const userResult = await client.query(`
    INSERT INTO users (email, password_hash, full_name, role)
    VALUES ($1, $2, $3, 'vendor')
    ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          full_name = EXCLUDED.full_name,
          role = 'vendor',
          updated_at = NOW()
    RETURNING id
  `, [demoVendor.email, passwordHash, demoVendor.brand]);

  const userId = userResult.rows[0].id;

  const vendorResult = await client.query(`
    INSERT INTO vendors (user_id, brand_name, country, story, status)
    VALUES ($1, $2, $3, $4, 'approved')
    ON CONFLICT (user_id) DO UPDATE
      SET brand_name = EXCLUDED.brand_name,
          country = EXCLUDED.country,
          story = EXCLUDED.story,
          status = 'approved',
          updated_at = NOW()
    RETURNING id
  `, [userId, demoVendor.brand, demoVendor.country, demoVendor.story]);

  const vendorId = vendorResult.rows[0].id;

  for (const [legacyId, name, brand, category, priceKobo, image, badge] of products) {
    await client.query(`
      INSERT INTO products (
        legacy_id, vendor_id, name, brand, category, price_kobo,
        currency, image_url, badge, stock, active
      )
      VALUES ($1,$2,$3,$4,$5,$6,'USD',$7,$8,25,TRUE)
      ON CONFLICT (legacy_id) DO UPDATE SET
        vendor_id = EXCLUDED.vendor_id,
        name = EXCLUDED.name,
        brand = EXCLUDED.brand,
        category = EXCLUDED.category,
        price_kobo = EXCLUDED.price_kobo,
        currency = EXCLUDED.currency,
        image_url = EXCLUDED.image_url,
        badge = EXCLUDED.badge,
        stock = 25,
        active = TRUE,
        updated_at = NOW()
    `, [legacyId, vendorId, name, brand, category, priceKobo, image, badge]);
  }

  for (const order of demoOrders) {
    await client.query('DELETE FROM orders WHERE order_number = $1', [order.number]);

    let subtotal = 0;
    const resolvedItems = [];

    for (const [legacyId, quantity] of order.items) {
      const productResult = await client.query(`
        SELECT id, name, brand, price_kobo
        FROM products
        WHERE legacy_id = $1 AND vendor_id = $2
      `, [legacyId, vendorId]);

      const product = productResult.rows[0];
      if (!product) throw new Error(`Seed product ${legacyId} was not found.`);

      const lineTotal = Number(product.price_kobo) * quantity;
      subtotal += lineTotal;
      resolvedItems.push({ product, quantity, lineTotal });
    }

    const orderResult = await client.query(`
      INSERT INTO orders (
        order_number, email, full_name, delivery_address,
        subtotal_kobo, shipping_kobo, total_kobo, currency,
        status, payment_reference, paid_at
      )
      VALUES ($1,$2,$3,$4,$5,0,$5,'USD',$6,$7,$8)
      RETURNING id
    `, [
      order.number,
      order.email,
      order.name,
      order.address,
      subtotal,
      order.status,
      order.status === 'pending_payment' ? null : `DEMO-${order.number}`,
      order.status === 'pending_payment' ? null : new Date()
    ]);

    for (const { product, quantity, lineTotal } of resolvedItems) {
      await client.query(`
        INSERT INTO order_items (
          order_id, product_id, vendor_id, product_name, brand,
          unit_price_kobo, quantity, line_total_kobo
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [
        orderResult.rows[0].id,
        product.id,
        vendorId,
        product.name,
        product.brand,
        product.price_kobo,
        quantity,
        lineTotal
      ]);
    }
  }

  await client.query(`
    UPDATE products
    SET stock = 25 - COALESCE((
      SELECT SUM(oi.quantity)
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = products.id
        AND oi.vendor_id = $1
        AND o.status IN ('paid','processing','shipped','delivered')
        AND o.order_number LIKE 'SO-Demo-%'
    ), 0), updated_at = NOW()
    WHERE vendor_id = $1
  `, [vendorId]);

  await client.query('COMMIT');

  console.log('SOLEA demo data seeded successfully.');
  console.log(`Demo vendor email: ${demoVendor.email}`);
  console.log(`Demo vendor password: ${demoPassword}`);
  console.log(`Seeded ${products.length} vendor products and ${demoOrders.length} demo orders.`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
