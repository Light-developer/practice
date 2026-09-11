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

const client = await pool.connect();
try {
  await client.query('BEGIN');
  for (const [legacyId,name,brand,category,price,image,badge] of products) {
    await client.query(`INSERT INTO products (legacy_id,name,brand,category,price_kobo,currency,image_url,badge,stock) VALUES ($1,$2,$3,$4,$5,'USD',$6,$7,25) ON CONFLICT (legacy_id) DO UPDATE SET name=EXCLUDED.name,brand=EXCLUDED.brand,category=EXCLUDED.category,price_kobo=EXCLUDED.price_kobo,currency=EXCLUDED.currency,image_url=EXCLUDED.image_url,badge=EXCLUDED.badge`, [legacyId,name,brand,category,price*100,image,badge]);
  }
  await client.query('COMMIT');
  console.log(`Seeded ${products.length} SOLEA products.`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
