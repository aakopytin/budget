// Proxy to Aspro Cloud API
// Env vars: ASPRO_DOMAIN (e.g. 2cec.aspro.cloud), ASPRO_API_KEY
// Supported entities: plan_money, transaction, categories

const ALLOWED = ['plan_money', 'transaction', 'categories'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const entity = req.query.entity;
  if (!ALLOWED.includes(entity)) {
    return res.status(400).json({ error: 'entity not allowed' });
  }

  const domain = process.env.ASPRO_DOMAIN;
  const apiKey = process.env.ASPRO_API_KEY;
  if (!domain || !apiKey) {
    return res.status(500).json({ error: 'ASPRO_DOMAIN / ASPRO_API_KEY not set' });
  }

  // Pass through all query params except 'entity', append api_key
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k !== 'entity') params.append(k, v);
  }
  params.append('api_key', apiKey);

  const url = `https://${domain}/api/v1/module/fin/${entity}/list?${params}`;

  try {
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
