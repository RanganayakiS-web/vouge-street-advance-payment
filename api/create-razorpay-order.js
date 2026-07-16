// Vouge Street — Create Razorpay Order (server-side)
// Creates a ₹99 Razorpay order. Client uses this order_id for payment.
//
// CHANGE vs old version: now accepts the full cart + customer and STASHES a compact
// copy in the Razorpay ORDER notes. This lets the webhook rebuild and create the
// Shopify order server-side if the shopper's browser never finishes (e.g. mobile UPI).

import { buildRazorpayNotes } from './_shopify-order.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://voguestreet.in');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cart_total, customer_phone, customer_name, cart, customer } = req.body || {};

  if (!cart_total || !customer_phone) {
    return res.status(400).json({ error: 'Missing cart_total or customer_phone' });
  }

  try {
    // Build notes. Prefer the full cart+customer (for webhook fallback); fall back to minimal.
    let notes;
    if (cart && cart.items && customer) {
      notes = buildRazorpayNotes({ cart, customer });
    } else {
      notes = {
        type: 'cod_advance',
        total_paise: String(cart_total),
        n_first: customer_name || '',
        phone: customer_phone || '',
      };
    }

    const auth = Buffer.from(
      `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
    ).toString('base64');

    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
      body: JSON.stringify({
        amount: 9900,
        currency: 'INR',
        receipt: `vs_${Date.now()}`,
        notes,
      }),
    });

    if (!rzpRes.ok) {
      const err = await rzpRes.text();
      console.error('Razorpay order creation failed:', err);
      return res.status(500).json({ error: 'Failed to create Razorpay order', details: err });
    }

    const order = await rzpRes.json();

    return res.status(200).json({
      order_id: order.id,
      amount:   order.amount,
      currency: order.currency,
      key:      process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('create-razorpay-order exception:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
