// Vouge Street — Create Razorpay Order (server-side)
// Creates a ₹99 Razorpay order. Client uses this order_id for payment.
// Signature can only be verified if order_id came from server.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://vougestreet.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cart_total, customer_phone, customer_name } = req.body || {};

  if (!cart_total || !customer_phone) {
    return res.status(400).json({ error: 'Missing cart_total or customer_phone' });
  }

  try {
    const auth = Buffer.from(
      `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
    ).toString('base64');

    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount: 9900,
        currency: 'INR',
        receipt: `vs_${Date.now()}`,
        notes: {
          type: 'cod_advance',
          cart_total_paise: String(cart_total),
          customer_name: customer_name || '',
          customer_phone: customer_phone || '',
        },
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
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('create-razorpay-order exception:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
