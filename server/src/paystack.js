import crypto from 'node:crypto';

const PAYSTACK_API = 'https://api.paystack.co';

function headers() {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is not configured');
  return {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json'
  };
}

export async function initializeTransaction({ email, amount, reference, callbackUrl, metadata }) {
  const response = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      email,
      amount: String(amount),
      currency: process.env.PAYSTACK_CURRENCY || 'USD',
      reference,
      callback_url: callbackUrl,
      metadata: JSON.stringify(metadata)
    })
  });

  const data = await response.json();
  if (!response.ok || !data.status) throw new Error(data.message || 'Unable to initialize payment');
  return data.data;
}

export async function verifyTransaction(reference) {
  const response = await fetch(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: headers()
  });
  const data = await response.json();
  if (!response.ok || !data.status) throw new Error(data.message || 'Unable to verify payment');
  return data.data;
}

export function verifyWebhookSignature(rawBody, signature) {
  if (!signature || !process.env.PAYSTACK_SECRET_KEY || !Buffer.isBuffer(rawBody)) return false;
  const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
  const provided = String(signature).trim().toLowerCase();
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'));
}
