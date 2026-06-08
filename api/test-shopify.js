// Temporary diagnostic endpoint — tests Shopify token without creating an order
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const r = await fetch(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/orders.json?limit=1`,
      { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN } }
    );
    const body = await r.text();
    return res.status(200).json({
      shopify_status: r.status,
      shopify_ok: r.ok,
      store_domain: process.env.SHOPIFY_STORE_DOMAIN,
      token_set: !!process.env.SHOPIFY_ADMIN_TOKEN,
      response_preview: body.slice(0, 500)
    });
  } catch(e) {
    return res.status(200).json({ error: e.message });
  }
}
