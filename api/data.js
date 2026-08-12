// Proxy to Aspro Cloud API — server-side pagination
// Env vars: ASPRO_API_KEY, ASPRO_DOMAIN
// GET: entity/page/limit from query params; returns raw Aspro response (d.response.items)
// POST: domain/entity from body; returns {items, total}

const https = require('https');

const GET_ALLOWED = ['plan_money', 'transaction', 'categories', 'transaction_pls'];
const ALLOWED = ['plan_money', 'transaction', 'categories', 'transaction_pls', 'bank_account'];
const PAGE_SIZE = 100;

function readJsonBody(req) {
  return new Promise(function(resolve) {
    var d = '';
    req.on('data', function(c) { d += c.toString(); });
    req.on('end', function() {
      try { resolve(JSON.parse(d)); }
      catch(e) { resolve({}); }
    });
    req.on('error', function() { resolve({}); });
  });
}

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const apiKey = process.env.ASPRO_API_KEY;
  if (!apiKey) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'ASPRO_API_KEY not set' }));
  }

  // ── GET handler — для виджета НДС Прогноз и ДДС (fetchAll/loadAll через GET) ──
  if (req.method === 'GET') {
    const q = req.query || {};
    const entity = q.entity || '';
    const page   = Math.max(1, parseInt(q.page  || '1',   10));
    const limit  = Math.min(100, parseInt(q.limit || '100', 10));

    if (!GET_ALLOWED.includes(entity)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'entity not allowed for GET' }));
    }

    const rawDomain = (process.env.ASPRO_DOMAIN || '2cec.aspro.cloud')
      .replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const url = 'https://' + rawDomain + '/api/v1/module/fin/' + entity + '/list'
      + '?api_key=' + encodeURIComponent(apiKey)
      + '&limit=' + limit + '&page=' + page;

    try {
      const data = await httpsGet(url);
      return res.end(JSON.stringify(data)); // возвращаем сырой ответ Aspro
    } catch (err) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const body = await readJsonBody(req);
  const domain = body.domain;
  const entity = body.entity;

  if (!domain || !entity) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Missing domain or entity', got: { domain: !!domain, entity: !!entity } }));
  }

  if (!ALLOWED.includes(entity)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'entity not allowed' }));
  }

  const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const base = 'https://' + cleanDomain + '/api/v1/module/fin/' + entity + '/list'
    + '?api_key=' + encodeURIComponent(apiKey) + '&limit=' + PAGE_SIZE;

  try {
    const d0 = await httpsGet(base + '&page=1');
    if (!d0.response) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ error: 'unexpected_aspro_response', raw: d0 }));
    }
    const firstItems = d0.response.items || d0.response.records || [];
    const total = d0.response.total || 0;

    if (firstItems.length === 0 || total <= PAGE_SIZE) {
      return res.end(JSON.stringify({ items: firstItems, total: total }));
    }

    const totalPages = Math.ceil(total / PAGE_SIZE);
    const allItems = [...firstItems];

    for (let page = 2; page <= Math.min(totalPages, 60); page++) {
      const d = await httpsGet(base + '&page=' + page);
      const items = (d.response && (d.response.items || d.response.records)) || [];
      if (items.length === 0) break;
      allItems.push(...items);
    }

    return res.end(JSON.stringify({ items: allItems, total: total }));
  } catch (err) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: err.message }));
  }
};
