// Vouge Street — Verify Razorpay Payment + Create Shopify Order
// 1. Verifies Razorpay HMAC-SHA256 signature (server-side)
// 2. Creates Shopify order with COD tags, notes, ₹99 transaction recorded

import crypto from 'crypto';

// Simple in-memory dedup (prevents double orders on retry within same process)
const processedPayments = new Set();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://voguestreet.in');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    cart,
    customer,
  } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing Razorpay payment details' });
  }
  if (!cart?.items?.length || !customer?.phone || !customer?.address1) {
    return res.status(400).json({ error: 'Missing cart or customer details' });
  }

  if (processedPayments.has(razorpay_payment_id)) {
    return res.status(409).json({ error: 'Payment already processed' });
  }

  const signatureBody = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(signatureBody)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    console.error('SIGNATURE MISMATCH', { expected: expectedSignature, received: razorpay_signature });
    return res.status(400).json({ error: 'Payment verification failed — invalid signature' });
  }

  try {
    const cartTotalRupees = Math.round(cart.total_price / 100);
    const balanceCOD      = cartTotalRupees - 99;

    const lineItems = cart.items.map(item => ({
      variant_id: item.variant_id,
      quantity:   item.quantity,
      price:      (item.price / 100).toFixed(2),
    }));

    const shippingAddress = {
      first_name: customer.first_name,
      last_name:  customer.last_name,
      phone:      customer.phone,
      address1:   customer.address1,
      city:       customer.city,
      province:   customer.province || '',
      zip:        customer.zip,
      country:    'India',
      country_code: 'IN',
    };

    const orderPayload = {
      order: {
        line_items: lineItems,
        customer: {
          first_name: customer.first_name,
          last_name:  customer.last_name,
          email:      customer.email || '',
          phone:      customer.phone,
        },
        billing_address:  shippingAddress,
        shipping_address: shippingAddress,
        financial_status: 'partially_paid',
        transactions: [
          {
            kind:          'capture',
            status:        'success',
            amount:        '99.00',
            currency:      'INR',
            gateway:       'Razorpay',
            authorization: razorpay_payment_id,
          },
        ],
        tags: 'COD, Advance Paid, Advance Amount: ₹99',
        note: `COD Order — ₹99 advance paid via Razorpay\nPayment ID: ${razorpay_payment_id}\nBalance to collect: ₹${balanceCOD}`,
        note_attributes: [
          { name: 'payment_type',        value: 'cod_advance' },
          { name: 'advance_paid',        value: '₹99' },
          { name: 'balance_cod',         value: `₹${balanceCOD}` },
          { name: 'order_total',         value: `₹${cartTotalRupees}` },
          { name: 'razorpay_payment_id', value: razorpay_payment_id },
          { name: 'razorpay_order_id',   value: razorpay_order_id },
          { name: 'prepaid_amount',      value: '99' },
          { name: 'cod_amount',          value: String(balanceCOD) },
        ],
        send_receipt: true,
        send_fulfillment_receipt: true,
      },
    };

    const shopifyRes = await fetch(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
        },
        body: JSON.stringify(orderPayload),
      }
    );

    if (!shopifyRes.ok) {
      const errText = await shopifyRes.text();
      console.error('Shopify order creation failed:', errText);
      return res.status(502).json({ error: 'Order creation failed', details: errText });
    }

    const { order } = await shopifyRes.json();

    processedPayments.add(razorpay_payment_id);
    setTimeout(() => processedPayments.delete(razorpay_payment_id), 3_600_000);

    console.log('VS ORDER CREATED', {
      order_id:    order.id,
      order_name:  order.name,
      customer:    `${customer.first_name} ${customer.last_name}`,
      phone:       customer.phone,
      city:        customer.city,
      total:       `₹${cartTotalRupees}`,
      advance:     '₹99',
      balance_cod: `₹${balanceCOD}`,
      payment_id:  razorpay_payment_id,
    });

    return res.status(200).json({
      success:     true,
      order_id:    order.id,
      order_name:  order.name,
      balance_cod: balanceCOD,
      total:       cartTotalRupees,
      payment_id:  razorpay_payment_id,
    });

  } catch (err) {
    console.error('verify-and-create-order exception:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}
