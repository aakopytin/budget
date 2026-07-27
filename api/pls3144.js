// Proxy: transaction_pls filtered by category_id=3144 (НДС к вычету)
// GET /api/pls3144?start=YYYY-MM-DD&end=YYYY-MM-DD&page=N
// Returns raw Aspro response: { response: { items: [...], total: N } }

const https = require('https');

function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(resp) {
      let data = '';
      resp.on('data', function(chunk) { data += chunk; });
      resp.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const apiKey = process.env.ASPRO_API_KEY;
  if (!apiKey) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'ASPRO_API_KEY not set' }));
  }

  const domain = process.env.ASPRO_DOMAIN || '2cec.aspro.cloud';
  const q = req.query || {};

  // Build Aspro URL directly — no entity/ALLOWED indirection
  const params = new URLSearchParams();
  params.append('api_key', apiKey);
  params.append('limit', '100');
  params.append('page', q.page || '1');
  if (q.start) params.append('filter[date][start_date]', q.start);
  if (q.end)   params.append('filter[date][end_date]',   q.end);
  params.append('filter[category_id]', '3144');

  const url = 'https://' + domain + '/api/v1/module/fin/transaction_pls/list?' + params.toString();

  try {
    const data = await httpsGet(url);
    res.statusCode = 200;
    res.end(JSON.stringify(data));
  } catch(err) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: err.message }));
  }
};
