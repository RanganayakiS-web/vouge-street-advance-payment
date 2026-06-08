export default async function handler(req, res) {
  const { code, shop, state } = req.query;

  if (!code || !shop) {
    return res.status(400).send('Missing code or shop parameter');
  }

  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
        code,
      }),
    });

    const data = await tokenRes.json();

    if (data.access_token) {
      // Display the token — copy it to Vercel env vars as SHOPIFY_ADMIN_TOKEN
      return res.status(200).send(`
        <html><body style="font-family:monospace;padding:40px;background:#f0f0f0">
          <h2>✅ OAuth Success!</h2>
          <p><strong>Shop:</strong> ${shop}</p>
          <p><strong>Access Token (copy this to Vercel SHOPIFY_ADMIN_TOKEN):</strong></p>
          <textarea style="width:100%;padding:10px;font-size:14px" rows="3">${data.access_token}</textarea>
          <p style="color:red">⚠️ Delete this endpoint after copying the token!</p>
        </body></html>
      `);
    } else {
      return res.status(500).send(`Token exchange failed: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    return res.status(500).send(`Error: ${err.message}`);
  }
}
