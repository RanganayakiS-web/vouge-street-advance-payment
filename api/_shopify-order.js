// Vouge Street — Shared Shopify order creation
// Used by BOTH verify-and-create-order.js (browser path) and razorpay-webhook.js (server path).
// Files in /api prefixed with "_" are NOT exposed as routes by Vercel — safe as a shared helper.
//
// Guarantees:
//  1. Idempotent — never creates a second order for the same razorpay_payment_id
//     (each order is tagged "rzp-<payment_id>", which we search before creating).
//  2. Applies the cart's automatic discount (API-created orders do NOT inherit Shopify
//     automatic discounts) as a fixed-amount order discount = gross subtotal − discounted total.

const SHOP  = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const V     = '2024-01';

async function shopifyREST(path, method, body) {
  return fetch(`https://${SHOP}/admin/api/${V}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function shopifyGraphQL(query, variables) {
  const r = await fetch(`https://${SHOP}/admin/api/${V}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

// Look up an existing order by the payment tag (dedup).
export async function findOrderByPayment(paymentId) {
  const tag = `rzp-${paymentId}`;
  const data = await shopifyGraphQL(
    `query($q:String!){ orders(first:1, query:$q){ edges{ node{ id name } } } }`,
    { q: `tag:${tag}` }
  );
  const edges = (data && data.data && data.data.orders && data.data.orders.edges) || [];
  return edges.length ? edges[0].node : null;
}

// cart = { total_price(paise), items_subtotal_price(paise), items:[{variant_id, quantity, price?(paise)}] }
// customer = { first_name, last_name, email, phone, address1, city, zip, province }
export async function createShopifyOrder({ razorpay_order_id, razorpay_payment_id, cart, customer }) {
  if (!cart || !cart.items || !cart.items.length) throw new Error('createShopifyOrder: empty cart');
  if (!customer || !customer.phone || !customer.address1) throw new Error('createShopifyOrder: missing customer');

  // 1. Idempotency guard — skip if this payment already produced an order.
  const existing = await findOrderByPayment(razorpay_payment_id);
  if (existing) {
    return { created: false, duplicate: true, order: { id: existing.id, name: existing.name } };
  }

  // 2. Money math (all storefront values are in paise).
  const totalPaise  = Number(cart.total_price) || 0;
  const subPaise    = Number(cart.items_subtotal_price) || totalPaise;
  const cartTotalRs = Math.round(totalPaise / 100);
  const grossRs     = Math.round(subPaise / 100);
  const discountRs  = Math.max(0, grossRs - cartTotalRs);
  const balanceCOD  = cartTotalRs - 99;

  const lineItems = cart.items.map((it) => {
    const li = { variant_id: it.variant_id, quantity: it.quantity };
    if (it.price != null) li.price = (Number(it.price) / 100).toFixed(2);
    return li;
  });

  const discountCodes = discountRs > 0
    ? [{ code: 'LAUNCH OFFER', amount: discountRs.toFixed(2), type: 'fixed_amount' }]
    : [];

  const address = {
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

  const payload = {
    order: {
      line_items:     lineItems,
      discount_codes: discountCodes,
      billing_address:  address,
      shipping_address: address,
      financial_status: 'partially_paid',
      transactions: [
        { kind: 'capture', status: 'success', amount: '99.00', currency: 'INR', gateway: 'Razorpay', authorization: razorpay_payment_id },
      ],
      // The rzp-<payment_id> tag is what makes creation idempotent.
      tags: `COD, Advance Paid, rzp-${razorpay_payment_id}`,
      note: `COD Order — ₹99 advance paid via Razorpay\nPayment ID: ${razorpay_payment_id}\nBalance to collect: ₹${balanceCOD}`,
      note_attributes: [
        { name: 'payment_type',        value: 'cod_advance' },
        { name: 'advance_paid',        value: '₹99' },
        { name: 'balance_cod',         value: `₹${balanceCOD}` },
        { name: 'order_total',         value: `₹${cartTotalRs}` },
        { name: 'bundle_discount',     value: `₹${discountRs}` },
        { name: 'razorpay_payment_id', value: razorpay_payment_id },
        { name: 'razorpay_order_id',   value: razorpay_order_id || '' },
        { name: 'prepaid_amount',      value: '99' },
        { name: 'cod_amount',          value: String(balanceCOD) },
      ],
      send_receipt: !!customer.email,
      send_fulfillment_receipt: !!customer.email,
    },
  };

  // Associate the order with a customer by EMAIL only. We deliberately do NOT send a
  // customer object with a phone_number: Shopify enforces phone uniqueness across customers,
  // so a repeat / re-used phone throws "phone_number has already been taken" and blocks the
  // whole order. The phone still travels on the shipping/billing address for couriers.
  if (customer.email) payload.order.email = customer.email;

  const r = await shopifyREST('orders.json', 'POST', payload);
  if (!r.ok) {
    const t = await r.text();
    throw new Error('Shopify order creation failed: ' + t);
  }
  const { order } = await r.json();
  return { created: true, duplicate: false, order: { id: order.id, name: order.name, total: cartTotalRs, balance_cod: balanceCOD } };
}

// ── Razorpay-notes stash / parse (so the webhook can rebuild the order) ──────
// Razorpay order notes allow up to 15 string keys, 256 chars each.
export function buildRazorpayNotes({ cart, customer }) {
  const items = (cart.items || []).map((i) => `${i.variant_id}:${i.quantity}`).join(',');
  return {
    type:       'cod_advance',
    n_first:    (customer.first_name || '').slice(0, 120),
    n_last:     (customer.last_name  || '').slice(0, 120),
    phone:      (customer.phone      || '').slice(0, 20),
    email:      (customer.email      || '').slice(0, 200),
    addr:       (customer.address1   || '').slice(0, 255),
    city:       (customer.city       || '').slice(0, 120),
    zip:        (customer.zip        || '').slice(0, 12),
    prov:       (customer.province   || '').slice(0, 120),
    items:      items.slice(0, 255),
    total_paise: String(cart.total_price || ''),
    sub_paise:   String(cart.items_subtotal_price || ''),
  };
}

export function parseRazorpayNotes(notes) {
  notes = notes || {};
  const items = (notes.items || '')
    .split(',')
    .filter(Boolean)
    .map((pair) => {
      const parts = pair.split(':');
      return { variant_id: Number(parts[0]), quantity: Number(parts[1]) || 1 };
    });
  return {
    cart: {
      total_price:          Number(notes.total_paise) || 0,
      items_subtotal_price: Number(notes.sub_paise) || Number(notes.total_paise) || 0,
      items,
    },
    customer: {
      first_name: notes.n_first || '',
      last_name:  notes.n_last || '',
      phone:      notes.phone || '',
      email:      notes.email || '',
      address1:   notes.addr || '',
      city:       notes.city || '',
      zip:        notes.zip || '',
      province:   notes.prov || '',
    },
  };
}
