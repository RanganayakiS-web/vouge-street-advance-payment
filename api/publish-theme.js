export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://vougestreet.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const shopifyRes = await fetch(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/themes/188662382901.json`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN }, body: JSON.stringify({theme: {id: 188662382901, role: 'main'}}) }
  );
  const data = await shopifyRes.json();
  return res.status(shopifyRes.status).json(data);
}
