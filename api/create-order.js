// Vouge Street — Advance Payment Handler
// No Shopify Admin token required
// Order details are stored in Razorpay payment notes

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://voguestreet.in');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { razorpay_payment_id, items, customer, cart_total } = req.body;

  if (!razorpay_payment_id || !items?.length || !customer?.phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const balanceDue = Math.round((cart_total / 100) - 99);
  const orderRef  = 'VS-' + razorpay_payment_id.slice(-8).toUpperCase();
  const itemsList = items.map(i => `${i.quantity}x ${i.title}${i.variant_title && i.variant_title !== 'Default Title' ? ' (' + i.variant_title + ')' : ''}`).join(', ');

  console.log('ADVANCE ORDER', {
    ref:        orderRef,
    payment_id: razorpay_payment_id,
    customer:   customer.name,
    phone:      customer.phone,
    address:    `${customer.address1}, ${customer.city}, ${customer.province} - ${customer.zip}`,
    items:      itemsList,
    advance:    '\u20b999',
    balance:    `\u20b9${balanceDue}`,
    total:      `\u20b9${Math.round(cart_total / 100)}`,
  });

  return res.status(200).json({
    success:     true,
    order_name:  orderRef,
    balance_due: balanceDue,
    payment_id:  razorpay_payment_id,
  });
}
