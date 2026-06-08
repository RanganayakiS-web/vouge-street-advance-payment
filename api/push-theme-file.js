export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://vougestreet.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.headers['x-secret'] !== process.env.PUSH_SECRET) return res.status(401).json({error:'unauthorized'});
  const { filename, content } = req.body;
  const themeId = process.env.SHOPIFY_THEME_ID || '188662382901';
  const r = await fetch(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/themes/${themeId}/assets.json`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN },
      body: JSON.stringify({ asset: { key: filename, value: content } })
    }
  );
  const data = await r.json();
  return res.status(r.status).json(data);
}
