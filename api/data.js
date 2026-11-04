// Proxy to Aspro Cloud API — server-side pagination, повторы при сбоях соединения с Аспро
// Env vars: ASPRO_API_KEY, ASPRO_DOMAIN
// GET: entity/page/limit from query params; returns raw Aspro response (d.response.items)
//   GET ...&chunk=N — «пачка»: сервер сам загружает до 15 страниц Aspro (до 1500 записей) параллельно
//   и отдаёт их одним ответом { response: { items, total, pages } }. Виджет запрашивает chunk=0,1,2…
//   пока не получит total записей. Это в ~15 раз сокращает число вызовов функции.
//   Ответы GET кешируются CDN Vercel на 2 минуты (общий кеш для всех пользователей).
//   Параметр _t (любое значение) — принудительное обновление в обход кеша (кнопка ↻).
// POST: domain/entity from body; returns {items, total}

const https = require('https');

const GET_ALLOWED = ['plan_money', 'transaction', 'categories', 'transaction_pls', 'bank_account', 'crm_account'];
// Сущности не из модуля fin: entity → путь module/entity в Aspro API
const ENTITY_PATH = { crm_account: 'crm/account' };
const ALLOWED = ['plan_money', 'transaction', 'categories', 'transaction_pls', 'bank_account'];
const PAGE_SIZE = 100;
const CHUNK_PAGES = 15;      // страниц Aspro в одной «пачке» (ответ ≤ ~2 МБ, лимит Vercel 4,5 МБ)
const PARALLEL = 3;          // одновременных запросов к Aspro внутри пачки (при 5 Аспро отдавал пустые страницы)

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

// Один запрос к Аспро с таймаутом (не ждём системные ~15 с на зависшее соединение)
function httpsGetOnce(url, timeoutMs) {
  return new Promise(function(resolve, reject) {
    const req = https.get(url, function(resp) {
      let data = '';
      resp.on('data', function(chunk) { data += chunk; });
      resp.on('end', function() {
        var j;
        try { j = JSON.parse(data); }
        catch(e) { return reject(new Error('JSON parse (HTTP ' + resp.statusCode + '): ' + e.message)); }
        // Ответ без блока response (ограничение частоты запросов, ошибка Аспро) — сбой, а не пустой список
        if (resp.statusCode >= 400 || !j || !j.response) {
          return reject(new Error('Aspro HTTP ' + resp.statusCode + ': ' + JSON.stringify(j).slice(0, 200)));
        }
        resolve(j);
      });
    });
    req.setTimeout(timeoutMs, function() { req.destroy(new Error('timeout ' + timeoutMs + ' ms')); });
    req.on('error', reject);
  });
}
// Запрос с повторами: сбои соединения с Аспро (ETIMEDOUT, ECONNRESET, таймаут, не-JSON ответ)
// повторяются до 3 раз с паузой 0,7 и 1,5 с — виджет получает 502, только если все попытки неудачны.
const RETRY_DELAYS = [0, 700, 1500];
async function httpsGet(url) {
  let lastErr;
  for (let i = 0; i < RETRY_DELAYS.length; i++) {
    if (RETRY_DELAYS[i]) await new Promise(function(r) { setTimeout(r, RETRY_DELAYS[i]); });
    try { return await httpsGetOnce(url, 8000); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Загрузка пачки страниц first..last с проверкой полноты.
// Короткая страница (меньше 100 записей; последняя по total — меньше остатка) запрашивается повторно
// (до 3 раз, если за ней есть данные; до 2 раз в «хвосте»), берётся максимум.
// Если она так и осталась короткой:
//   • за ней в пачке или на следующей странице есть данные → «дыра» (Аспро отдал неполную страницу) → ошибка 502;
//   • дальше данных нет → короткий «хвост» законный (у Аспро total бывает больше реального числа записей,
//     например categories: total 104, отдаёт 90) — принимаем.
async function fetchChunkPages(pageUrl, first, last, totalPages, d0) {
  const pages = [];
  for (let p = first; p <= last; p++) pages.push(p);
  const res = {};
  res[first] = itemsOf(d0);
  const rest = pages.slice(1);
  for (let i = 0; i < rest.length; i += PARALLEL) {
    const part = await Promise.all(rest.slice(i, i + PARALLEL).map(function(p) { return httpsGet(pageUrl(p)); }));
    part.forEach(function(d, k) { res[rest[i + k]] = itemsOf(d); });
  }
  // Ожидаемое число записей: полная страница, на последней (по total) — остаток
  const total = (d0.response && d0.response.total) || 0;
  const expected = function(p) { return p < totalPages ? PAGE_SIZE : total - (totalPages - 1) * PAGE_SIZE; };
  const isShort = function(p) { return res[p].length < expected(p); };
  for (const p of pages) {
    // короткая страница, за которой в пачке есть данные, — почти наверняка сбой: до 3 повторов; короткий хвост — 2 повтора
    const tries = pages.some(function(q) { return q > p && res[q].length > 0; }) ? 3 : 2;
    for (let a = 1; a <= tries && isShort(p); a++) {
      await new Promise(function(r) { setTimeout(r, 700 * a); });
      const again = itemsOf(await httpsGet(pageUrl(p)));
      if (again.length > res[p].length) res[p] = again;
    }
  }
  let ended = false;
  for (const p of pages) {
    if (!isShort(p)) continue;
    let gap = pages.some(function(q) { return q > p && res[q].length > 0; });
    if (!gap && p === last && last < totalPages) gap = itemsOf(await httpsGet(pageUrl(last + 1))).length > 0;
    if (gap) throw new Error('incomplete_page ' + p + ': ' + res[p].length + ' records');
    ended = true;  // законный короткий хвост: записей больше нет
  }
  if (last === totalPages) ended = true;  // в пачке последняя страница — точное число записей известно
  let items = [];
  pages.forEach(function(p) { items = items.concat(res[p]); });
  return { items: items, ended: ended };
}

function itemsOf(data) {
  // Нормализуем items vs records (Aspro использует оба ключа для разных сущностей)
  return (data && data.response && (data.response.items || data.response.records)) || [];
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

  // ── GET handler — для виджетов НДС и ДДС (loadAll через GET) ──
  if (req.method === 'GET') {
    const q = req.query || {};
    const entity = q.entity || '';
    const limit  = Math.min(100, parseInt(q.limit || '100', 10));

    if (!GET_ALLOWED.includes(entity)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'entity not allowed for GET' }));
    }

    const rawDomain = (process.env.ASPRO_DOMAIN || '2cec.aspro.cloud')
      .replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const base = 'https://' + rawDomain + '/api/v1/module/' + (ENTITY_PATH[entity] || ('fin/' + entity)) + '/list'
      + '?api_key=' + encodeURIComponent(apiKey);
    const pageUrl = function(page, lim) { return base + '&limit=' + lim + '&page=' + page; };
    // Кеш CDN: обычные запросы — 2 минуты, принудительное обновление (_t) — без кеша
    const cacheHdr = q._t ? 'no-store' : 'public, s-maxage=120, stale-while-revalidate=60';

    try {
      // Режим «пачки»: до CHUNK_PAGES страниц одним ответом
      if (q.chunk !== undefined) {
        const chunk = Math.max(0, parseInt(q.chunk, 10) || 0);
        const first = chunk * CHUNK_PAGES + 1;
        const d0 = await httpsGet(pageUrl(first, PAGE_SIZE));
        const total = d0.response.total || 0;
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        if (first > totalPages || total === 0) {
          res.setHeader('Cache-Control', total === 0 ? 'no-store' : cacheHdr);  // пустой ответ не кешируем
          return res.end(JSON.stringify({ response: { items: [], total: total, pages: totalPages } }));
        }
        const last = Math.min(totalPages, first + CHUNK_PAGES - 1);
        const r = await fetchChunkPages(function(p) { return pageUrl(p, PAGE_SIZE); }, first, last, totalPages, d0);
        // Данные кончились раньше total (total Аспро завышен) — отдаём фактическое число записей, чтобы виджет не ждал остальные
        const realTotal = r.ended ? (first - 1) * PAGE_SIZE + r.items.length : total;
        res.setHeader('Cache-Control', cacheHdr);
        return res.end(JSON.stringify({ response: { items: r.items, total: realTotal, pages: totalPages } }));
      }

      // Режим одной страницы (как раньше)
      const page = Math.max(1, parseInt(q.page || '1', 10));
      const data = await httpsGet(pageUrl(page, limit));
      const items = itemsOf(data);
      const total = (data.response && data.response.total) || items.length;
      res.setHeader('Cache-Control', cacheHdr);
      return res.end(JSON.stringify({ response: { items, total } }));
    } catch (err) {
      res.setHeader('Cache-Control', 'no-store');
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
