// Vouge Street — Verify Razorpay Payment + Create Shopify Order (browser "fast path")
// 1. Verifies the Razorpay HMAC-SHA256 signature (server-side).
// 2. Creates the Shopify order via the shared, idempotent, discount-aware helper.
//
// This runs when the shopper's browser completes payment (reliable on desktop).
// On mobile it may not complete — razorpay-webhook.js is the server-side safety net.
// Both call the SAME helper, and the helper de-dupes on razorpay_payment_id, so they
// can never create two orders for one payment.

import crypto from 'crypto';
import { createShopifyOrder } from './_shopify-order.js';

const processedPayments = new Set(); // per-process retry guard

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://voguestreet.in');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, cart, customer } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing Razorpay payment details' });
  }
  if (!cart?.items?.length || !customer?.phone || !customer?.address1) {
    return res.status(400).json({ error: 'Missing cart or customer details' });
  }

  // Signature check
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  if (expected !== razorpay_signature) {
    console.error('SIGNATURE MISMATCH', { expected, received: razorpay_signature });
    return res.status(400).json({ error: 'Payment verification failed — invalid signature' });
  }

  try {
    const result = await createShopifyOrder({
      razorpay_order_id,
      razorpay_payment_id,
      cart,      // { total_price, items_subtotal_price, items:[{variant_id, quantity, price}] }
      customer,  // { first_name, last_name, email, phone, address1, city, zip, province }
    });

    processedPayments.add(razorpay_payment_id);
    setTimeout(() => processedPayments.delete(razorpay_payment_id), 3_600_000);

    console.log('VS ORDER (browser path)', {
      order_name: result.order.name, duplicate: result.duplicate, payment_id: razorpay_payment_id,
    });

    return res.status(200).json({
      success:     true,
      order_id:    result.order.id,
      order_name:  result.order.name,
      total:       result.order.total ?? Math.round((cart.total_price || 0) / 100),
      balance_cod: result.order.balance_cod ?? (Math.round((cart.total_price || 0) / 100) - 99),
      payment_id:  razorpay_payment_id,
      duplicate:   result.duplicate,
    });
  } catch (err) {
    console.error('verify-and-create-order exception:', err);
    // Even if this fails, the webhook will still create the order server-side.
    return res.status(500).json({ error: 'Order creation failed', message: err.message });
  }
}
