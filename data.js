// Proxy to Aspro Cloud API
// Env vars: ASPRO_DOMAIN (e.g. 2cec.aspro.cloud), ASPRO_API_KEY
// Supported entities: plan_money, transaction, categories, transaction_pls

const https = require('https');

const ALLOWED = ['plan_money', 'transaction', 'categories', 'transaction_pls'];

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  function send(status, body) {
    res.statusCode = status;
    res.end(JSON.stringify(body));
  }

  // Read entity from raw query string (req.query may parse brackets into nested objects)
  const rawQuery = (req.url || '').split('?')[1] || '';
  const rawParams = new URLSearchParams(rawQuery);
  const entity = rawParams.get('entity');

  if (!ALLOWED.includes(entity)) {
    return send(400, { error: 'entity not allowed: ' + entity });
  }

  const domain = process.env.ASPRO_DOMAIN || '2cec.aspro.cloud';
  const apiKey = process.env.ASPRO_API_KEY;
  if (!apiKey) {
    return send(500, { error: 'ASPRO_API_KEY not set' });
  }

  // Forward raw query string as-is (preserves filter[date][start_date] etc.), strip entity, add api_key
  rawParams.delete('entity');
  rawParams.append('api_key', apiKey);

  const url = 'https://' + domain + '/api/v1/module/fin/' + entity + '/list?' + rawParams.toString();

  try {
    const data = await httpsGet(url);
    send(200, data);
  } catch (err) {
    send(502, { error: err.message });
  }
};
