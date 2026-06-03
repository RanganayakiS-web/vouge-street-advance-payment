// Vouge Street — Advance Payment Order Creator
// Deployed on Vercel (free tier)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://vougestreet.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { razorpay_payment_id, items, customer, cart_total } = req.body;

  if (!razorpay_payment_id || !items?.length || !customer?.phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const balanceDue = Math.round((cart_total / 100) - 99);
  const nameParts = customer.name.trim().split(' ');
  const firstName = nameParts[0] || 'Customer';
  const lastName = nameParts.slice(1).join(' ') || '.';

  const draftOrderPayload = {
    draft_order: {
      line_items: items.map(item => ({ variant_id: item.variant_id, quantity: item.quantity })),
      shipping_address: { first_name: firstName, last_name: lastName, address1: customer.address1, city: customer.city, province: customer.province || 'Tamil Nadu', country: 'India', country_code: 'IN', zip: customer.zip, phone: customer.phone },
      billing_address: { first_name: firstName, last_name: lastName, address1: customer.address1, city: customer.city, province: customer.province || 'Tamil Nadu', country: 'India', country_code: 'IN', zip: customer.zip, phone: customer.phone },
      email: customer.email || '',
      phone: customer.phone,
      note: `ADVANCE PAYMENT ORDER\n₹99 paid via Razorpay\nPayment ID: ${razorpay_payment_id}\nBalance on delivery: ₹${balanceDue}\nCart total: ₹${Math.round(cart_total / 100)}`,
      note_attributes: [
        { name: 'payment_type', value: 'advance_razorpay' },
        { name: 'razorpay_payment_id', value: razorpay_payment_id },
        { name: 'advance_paid', value: '₹99' },
        { name: 'balance_due', value: `₹${balanceDue}` },
      ],
      tags: 'advance_paid,advance_razorpay,cod-balance',
      send_invoice: false,
    },
  };

  try {
    const shopifyRes = await fetch(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/draft_orders.json`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN },
        body: JSON.stringify(draftOrderPayload),
      }
    );
    const data = await shopifyRes.json();
    if (!shopifyRes.ok) return res.status(500).json({ error: 'Failed to create order', details: data.errors });
    const order = data.draft_order;
    return res.status(200).json({ success: true, order_id: order.id, order_name: order.name, balance_due: balanceDue, payment_id: razorpay_payment_id });
  } catch (err) {
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
}
