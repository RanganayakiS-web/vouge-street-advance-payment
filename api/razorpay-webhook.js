// Vouge Street — Razorpay Webhook Handler (SERVER-SIDE ORDER CREATION / SAFETY NET)
//
// This is the fix for the mobile-COD bug: order creation no longer depends on the
// shopper's browser. Razorpay calls this endpoint server-to-server on payment.captured,
// so the order is created even if the phone dropped the browser step (mobile UPI app-switch).
//
// Flow on payment.captured / order.paid:
//   1. Verify the webhook signature over the RAW body.
//   2. Read the Razorpay ORDER notes (stashed by create-razorpay-order.js) to rebuild
//      the cart + customer.
//   3. Create the Shopify order via the shared, idempotent helper (de-dupes on payment_id,
//      so it will NOT duplicate an order the browser already created on desktop).
//
// Set the webhook in the Razorpay Dashboard → Settings → Webhooks:
//   URL:    https://vouge-street-advance-payment.vercel.app/api/razorpay-webhook
//   Events: payment.captured, order.paid, payment.failed
//   Secret: must match process.env.RAZORPAY_WEBHOOK_SECRET

import crypto from 'crypto';
import { createShopifyOrder, parseRazorpayNotes } from './_shopify-order.js';

// We need the RAW request body to verify the signature reliably.
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function fetchRazorpayOrderNotes(orderId) {
  if (!orderId) return {};
  const auth = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString('base64');
  const r = await fetch(`https://api.razorpay.com/v1/orders/${orderId}`, {
    headers: { 'Authorization': `Basic ${auth}` },
  });
  if (!r.ok) return {};
  const order = await r.json();
  return order.notes || {};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let raw = '';
  try { raw = await readRawBody(req); } catch { return res.status(400).json({ error: 'no body' }); }

  // 1. Verify signature over the raw body.
  const secret    = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers['x-razorpay-signature'];
  if (secret) {
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (!signature || expected !== signature) {
      console.error('Webhook signature mismatch');
      return res.status(400).json({ error: 'Invalid signature' });
    }
  }

  let body;
  try { body = JSON.parse(raw); } catch { return res.status(400).json({ error: 'bad json' }); }

  const event   = body?.event;
  const payload = body?.payload;
  const payment = payload?.payment?.entity;
  const orderEnt = payload?.order?.entity;

  console.log('VS WEBHOOK', { event, payment_id: payment?.id, order_id: payment?.order_id || orderEnt?.id });

  try {
    if (event === 'payment.captured' || event === 'order.paid') {
      const razorpay_payment_id = payment?.id;
      const razorpay_order_id   = payment?.order_id || orderEnt?.id;
      if (!razorpay_payment_id || !razorpay_order_id) {
        return res.status(200).json({ received: true, skipped: 'missing ids' });
      }

      // Prefer notes already on the event; otherwise fetch the Razorpay order.
      let notes = orderEnt?.notes;
      if (!notes || !notes.items) notes = await fetchRazorpayOrderNotes(razorpay_order_id);

      const { cart, customer } = parseRazorpayNotes(notes);
      if (!cart.items.length || !customer.phone || !customer.address1) {
        // Not enough data to build a clean order (old-format notes). Log loudly so it's caught.
        console.error('WEBHOOK: insufficient notes to create order', { razorpay_payment_id, notes });
        return res.status(200).json({ received: true, skipped: 'insufficient notes' });
      }

      const result = await createShopifyOrder({ razorpay_order_id, razorpay_payment_id, cart, customer });
      console.log('VS ORDER (webhook path)', {
        order_name: result.order.name, duplicate: result.duplicate, payment_id: razorpay_payment_id,
      });
      return res.status(200).json({ received: true, order: result.order.name, duplicate: result.duplicate });
    }

    if (event === 'payment.failed') {
      console.log('PAYMENT FAILED', { payment_id: payment?.id, error: payment?.error_description });
      return res.status(200).json({ received: true });
    }

    console.log('UNHANDLED WEBHOOK EVENT:', event);
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('razorpay-webhook exception:', err);
    // Return 200 so Razorpay does not hammer retries forever; the error is logged for review.
    return res.status(200).json({ received: true, error: err.message });
  }
}
