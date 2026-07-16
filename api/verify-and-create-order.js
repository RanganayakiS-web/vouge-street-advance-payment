// Vouge Street — Verify Razorpay Payment (browser confirmation only)
//
// IMPORTANT: This endpoint does NOT create the Shopify order. Creation happens in exactly one
// place — razorpay-webhook.js, on the `payment.captured` event — so the browser and the webhook
// can never both create an order (that was the cause of duplicate orders). Here we verify the
// payment signature, then do a BEST-EFFORT lookup of the order the webhook just created so the
// confirmation screen can show the order number.
//
// The lookup uses a CONSISTENT read (list recent orders straight from the Admin API and match on
// the razorpay_payment_id note attribute) instead of Shopify's tag search, which is only
// eventually consistent. It is fully wrapped: if the order is not visible yet, we still return
// success with the amounts and simply omit order_name (the customer also receives it by email).

import crypto from 'crypto';

const SHOP  = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const V     = '2024-01';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Consistent read: list recent orders and match on the razorpay_payment_id note attribute.
async function findOrderName(paymentId) {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const url =
    `https://${SHOP}/admin/api/${V}/orders.json` +
    `?status=any&limit=50&created_at_min=${encodeURIComponent(since)}` +
    `&fields=id,name,note_attributes`;
  const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': TOKEN } });
  if (!r.ok) return null;
  const data = await r.json();
  const match = (data.orders || []).find((o) =>
    (o.note_attributes || []).some(
      (a) => a.name === 'razorpay_payment_id' && a.value === paymentId
    )
  );
  return match ? match.name : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://voguestreet.in');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, cart } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing Razorpay payment details' });
  }

  // Verify the payment signature server-side.
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  if (expected !== razorpay_signature) {
    console.error('SIGNATURE MISMATCH', { expected, received: razorpay_signature });
    return res.status(400).json({ error: 'Payment verification failed — invalid signature' });
  }

  const totalRs    = Math.round((cart && cart.total_price ? cart.total_price : 0) / 100);
  const balanceCOD = totalRs - 99;

  // Best-effort: give the webhook a few seconds to create the order, then read its number.
  // Wrapped so a lookup failure NEVER breaks the confirmation response.
  let order_name = null;
  try {
    for (let i = 0; i < 4 && !order_name; i++) {
      order_name = await findOrderName(razorpay_payment_id);
      if (!order_name && i < 3) await sleep(1300);
    }
  } catch (e) {
    console.error('order lookup failed (non-fatal):', e && e.message);
    order_name = null;
  }

  console.log('VS PAYMENT VERIFIED', {
    payment_id: razorpay_payment_id,
    total: totalRs,
    order_name: order_name || '(not visible yet)',
  });

  return res.status(200).json({
    success:     true,
    verified:    true,
    total:       totalRs,
    balance_cod: balanceCOD,
    payment_id:  razorpay_payment_id,
    order_name:  order_name || undefined,
  });
}
// Vouge Street — Verify Razorpay Payment (browser confirmation only)
//
// IMPORTANT: This endpoint NO LONGER creates the Shopify order. Order creation is done in
// exactly one place — razorpay-webhook.js, on the `payment.captured` event — so the browser
// and the webhook can never both create an order (that was causing duplicate orders, because
// Shopify's tag search isn't instantly consistent and the dedup check missed the just-created
// order). Here we only verify the payment signature and return the amounts the confirmation
// screen shows. The order appears in Shopify a moment later, created by the webhook.

import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://voguestreet.in');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, cart } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing Razorpay payment details' });
  }

  // Verify the payment signature server-side.
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  if (expected !== razorpay_signature) {
    console.error('SIGNATURE MISMATCH', { expected, received: razorpay_signature });
    return res.status(400).json({ error: 'Payment verification failed — invalid signature' });
  }

  const totalRs     = Math.round((cart && cart.total_price ? cart.total_price : 0) / 100);
  const balanceCOD  = totalRs - 99;

  console.log('VS PAYMENT VERIFIED (order will be created by webhook)', {
    payment_id: razorpay_payment_id, total: totalRs,
  });

  // order_name is intentionally omitted — the order is created by the webhook moments later.
  return res.status(200).json({
    success:     true,
    verified:    true,
    total:       totalRs,
    balance_cod: balanceCOD,
    payment_id:  razorpay_payment_id,
  });
}
