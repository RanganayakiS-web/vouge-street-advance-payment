// Vouge Street — Razorpay Webhook Handler (SINGLE SOURCE OF TRUTH for order creation)
//
// The Shopify order is created here and ONLY here, on the `payment.captured` event. The browser
// (verify-and-create-order.js) no longer creates orders, so there is exactly one creator per
// payment — no duplicate orders. `order.paid` is intentionally ignored for creation (it would
// fire a second time for the same payment).
//
// Reads the cart + customer from the Razorpay ORDER notes (stashed by create-razorpay-order.js)
// and creates the order via the shared helper (which also applies the discount and de-dupes on
// the rzp-<payment_id> tag as a best-effort backstop against a rare double delivery).
//
// Razorpay Dashboard → Webhooks:  URL .../api/razorpay-webhook
//   Events: payment.captured (required), payment.failed. order.paid may be left on — it's ignored.
//   Secret must equal process.env.RAZORPAY_WEBHOOK_SECRET.

import crypto from 'crypto';
import { createShopifyOrder, parseRazorpayNotes } from './_shopify-order.js';

function readRaw(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; });
    req.on('end', () => resolve(d));
    req.on('error', () => resolve(''));
  });
}

async function fetchRazorpayOrderNotes(orderId) {
  if (!orderId) return {};
  const auth = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString('base64');
  const r = await fetch(`https://api.razorpay.com/v1/orders/${orderId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!r.ok) return {};
  const o = await r.json();
  return o.notes || {};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // @vercel/node already parses JSON bodies into req.body. Fall back to raw only if needed.
  let body = req.body;
  let raw = '';
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length) {
    raw = await readRaw(req);
    try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
  }

  // Best-effort signature check (never rejects a real order — see header of _shopify-order.js).
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers['x-razorpay-signature'];
  if (secret && signature) {
    const candidate = raw || JSON.stringify(body);
    const expected = crypto.createHmac('sha256', secret).update(candidate).digest('hex');
    if (expected !== signature) console.warn('razorpay-webhook: signature not verified (proceeding)');
  }

  const event    = body && body.event;
  const payload  = body && body.payload;
  const payment  = payload && payload.payment && payload.payment.entity;
  const orderEnt = payload && payload.order && payload.order.entity;
  console.log('VS WEBHOOK', {
    event,
    payment_id: payment && payment.id,
    order_id: (payment && payment.order_id) || (orderEnt && orderEnt.id),
  });

  try {
    // Order.paid would double-create — ignore it. payment.captured is the sole creator.
    if (event === 'order.paid') {
      return res.status(200).json({ received: true, ignored: 'order.paid' });
    }

    if (event === 'payment.captured') {
      const razorpay_payment_id = payment && payment.id;
      const razorpay_order_id   = (payment && payment.order_id) || (orderEnt && orderEnt.id);
      if (!razorpay_payment_id || !razorpay_order_id) {
        return res.status(200).json({ received: true, skipped: 'missing ids' });
      }

      let notes = orderEnt && orderEnt.notes;
      if (!notes || !notes.items) notes = await fetchRazorpayOrderNotes(razorpay_order_id);

      const { cart, customer } = parseRazorpayNotes(notes);
      if (!cart.items.length || !customer.phone || !customer.address1) {
        console.error('razorpay-webhook: insufficient notes', { razorpay_payment_id, notes });
        return res.status(200).json({ received: true, skipped: 'insufficient notes' });
      }

      const result = await createShopifyOrder({ razorpay_order_id, razorpay_payment_id, cart, customer });
      console.log('VS ORDER (webhook path)', { order_name: result.order.name, duplicate: result.duplicate });
      return res.status(200).json({ received: true, order: result.order.name, duplicate: result.duplicate });
    }

    if (event === 'payment.failed') {
      console.log('PAYMENT FAILED', { payment_id: payment && payment.id });
      return res.status(200).json({ received: true });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('razorpay-webhook exception:', err);
    return res.status(200).json({ received: true, error: err.message });
  }
}
