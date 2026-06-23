// Proxy to Aspro Cloud API
// Env vars: ASPRO_DOMAIN (e.g. 2cec.aspro.cloud), ASPRO_API_KEY
// Supported entities: plan_money, transaction, categories

const https = require('https');

const ALLOWED = ['plan_money', 'transaction', 'categories'];

function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(resp) {
      let data = '';
      resp.on('data', function(chunk) { data += chunk; });
      resp.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  function send(status, body) {
    res.statusCode = status;
    res.end(JSON.stringify(body));
  }

  const entity = req.query.entity;
  if (!ALLOWED.includes(entity)) {
    return send(400, { error: 'entity not allowed' });
  }

  const domain = process.env.ASPRO_DOMAIN;
  const apiKey = process.env.ASPRO_API_KEY;
  if (!domain || !apiKey) {
    return send(500, { error: 'ASPRO_DOMAIN / ASPRO_API_KEY not set' });
  }

  // Pass through all query params except 'entity', append api_key
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k !== 'entity') params.append(k, v);
  }
  params.append('api_key', apiKey);

  const url = 'https://' + domain + '/api/v1/module/fin/' + entity + '/list?' + params.toString();

  try {
    const data = await httpsGet(url);
    send(200, data);
  } catch (err) {
    send(502, { error: err.message });
  }
};
