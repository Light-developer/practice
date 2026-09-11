# SOLEA API

Production backend foundation for the SOLEA multi-vendor footwear marketplace.

## Stack

- Node.js 20+
- Express
- PostgreSQL
- Paystack
- HTTP-only JWT session cookie
- Helmet security headers
- CORS
- Rate limiting

## Local setup

1. Create a PostgreSQL database named `solea`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and a long random `JWT_SECRET`.
3. Add your Paystack test secret key to `PAYSTACK_SECRET_KEY`.
4. From this directory run:

```bash
npm install
npm run db:init
npm run db:seed
npm run dev
```

The API will run on `http://localhost:4000` by default.

## Paystack

The checkout initializes payments from the server. The Paystack secret key is never sent to the browser. The server verifies payment status and amount before marking an order as paid. Configure the Paystack webhook URL as:

```text
https://YOUR-API-DOMAIN/api/payments/paystack/webhook
```

Paystack webhook signature validation is implemented with HMAC-SHA512.

The current storefront is priced in USD. A Nigeria-based Paystack business must have USD enabled before using USD transactions; otherwise change `PAYSTACK_CURRENCY` and the product currency/prices to NGN. Paystack documents USD availability for Nigeria and requires the appropriate account setup.

## Important deployment variables

```text
NODE_ENV=production
PORT=4000
DATABASE_URL=...
JWT_SECRET=...
FRONTEND_URL=https://your-storefront-domain.com
PAYSTACK_SECRET_KEY=sk_live_...
PAYSTACK_CURRENCY=USD
```

Never commit `.env` or any Paystack secret key.
