CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','vendor','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL UNIQUE,
  country TEXT,
  story TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended')),
  paystack_subaccount_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id INTEGER UNIQUE,
  vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  price_kobo BIGINT NOT NULL CHECK (price_kobo >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  image_url TEXT NOT NULL,
  badge TEXT,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  subtotal_kobo BIGINT NOT NULL CHECK (subtotal_kobo >= 0),
  shipping_kobo BIGINT NOT NULL CHECK (shipping_kobo >= 0),
  total_kobo BIGINT NOT NULL CHECK (total_kobo >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','paid','processing','shipped','delivered','cancelled','refunded')),
  payment_reference TEXT UNIQUE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  brand TEXT NOT NULL,
  unit_price_kobo BIGINT NOT NULL CHECK (unit_price_kobo >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_kobo BIGINT NOT NULL CHECK (line_total_kobo >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE INDEX IF NOT EXISTS idx_products_vendor ON products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment_reference ON orders(payment_reference);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE OR REPLACE FUNCTION decrement_paid_order_stock()
RETURNS TRIGGER AS $$
DECLARE
  item RECORD;
BEGIN
  IF NEW.status = 'paid' AND OLD.status <> 'paid' THEN
    FOR item IN SELECT product_id, quantity FROM order_items WHERE order_id = NEW.id LOOP
      UPDATE products
      SET stock = stock - item.quantity, updated_at = NOW()
      WHERE id = item.product_id AND stock >= item.quantity;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for product %', item.product_id;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_decrement_paid_order_stock ON orders;
CREATE TRIGGER trg_decrement_paid_order_stock
BEFORE UPDATE OF status ON orders
FOR EACH ROW
EXECUTE FUNCTION decrement_paid_order_stock();
