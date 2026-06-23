// Budget widget entry point — handles both GET and POST (Aspro miniapp mechanism)
module.exports = function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(HTML);
};

const HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Сводный финансовый отчёт</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 11px;
    background: #f8f9fd;
    padding: 12px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    flex-wrap: wrap;
    gap: 6px;
  }
  .title { font-size: 14px; font-weight: 700; color: #111827; }
  .subtitle { font-size: 10px; color: #9ca3af; margin-left: 8px; }
  .status-row { display: flex; gap: 6px; align-items: center; }
  #status { font-size: 10.5px; color: #d97706; }
  #refresh-btn {
    background: none;
    border: 1px solid #d1d5db;
    color: #6b7280;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
  }
  #refresh-btn:hover { background: #f3f4f6; }
  #content { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { white-space: nowrap; }
</style>
</head>
<body>

<div class="header">
  <div>
    <span class="title">&#128202; Сводный финансовый отчёт</span>
    <span class="subtitle">Все суммы в тысячах рублей</span>
  </div>
  <div class="status-row">
    <span id="status">&#9679; инициализация...</span>
    <button id="refresh-btn" title="Обновить">&#8635;</button>
  </div>
</div>

<div id="content">
  <div style="padding:20px;text-align:center;color:#6b7280">&#8987; Загружаем данные...</div>
</div>

<script>
(function () {
  'use strict';

  // ── Справочники ────────────────────────────────────────────────
  const PID_MAP = {
    1:'Кемерово', 6:'Десногорск', 12:'Киров', 23:'Сыктывкар', 13:'Барнаул',
    9:'Рузаевка', 3:'Ю-Сахалинск', 25:'Ю-Сахалинск', 7:'Иволгинск',
    2:'Центр. договор', 18:'Центр. договор', 19:'Центр. договор',
    29:'Центр. договор', 30:'Центр. договор', 31:'Центр. договор', 32:'Центр. договор',
    22:'Прочие', 20:'Прочие', 17:'Прочие', 21:'Прочие',
    24:'ОХР (ВСИП+ТТ)', 26:'ОХР (ВСИП+ТТ)',
  };

  const PROJECTS = [
    'Кемерово','Десногорск','Киров','Сыктывкар','Барнаул',
    'Рузаевка','Ю-Сахалинск','Иволгинск','Центр. договор','Прочие','ОХР (ВСИП+ТТ)',
  ];

  const SKIP = new Set([
    'Перевод между счетами (поступление)',
    'Перевод между счетами (списание)',
    'Расходы на услуги банков',
    'Получение кредита',
    'Тесты и испытания',
    'Услуги по сертификации',
    'Составление исполнительной документации',
  ]);
  const INC_TYPES = new Set([
    'Оказание услуг','Возврат ДС. за заказы','Проценты к получению',
  ]);
  const EXP_PROJ = new Set(['Командировки']);

  function isIncome(t) { return INC_TYPES.has(t); }
  function isExpense(t, proj) {
    if (SKIP.has(t)) return false;
    const l = t.toLowerCase();
    if (proj === 'ОХР (ВСИП+ТТ)') return true;
    if (proj === 'Прочие' && t === 'Возвраты клиентам') return true;
    return (
      l.startsWith('материал') || l.startsWith('смр') ||
      (l.includes('банков') && l.includes('гарант')) ||
      l.includes('проектирован') || l.includes('изыскан') ||
      l.includes('оборудован') || l.includes('мобилизац') ||
      EXP_PROJ.has(t)
    );
  }

  const MS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const PM_MONTHS = ['Июл','Авг','Сен','Окт','Ноя','Дек'];

  // ── Форматирование ─────────────────────────────────────────────
  function fmtK(v, bold, resColor) {
    if (!v) {
      const c = resColor ? '#6b7280' : '#ccc';
      return '<span style="color:' + c + '">—</span>';
    }
    const parts = (Math.abs(v) / 1000).toFixed(1).split('.');
    parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, '\\u00a0');
    const s = parts.join('.');
    if (resColor) {
      const c = v >= 0 ? '#6ee7b7' : '#fca5a5';
      return v < 0
        ? '<strong style="color:' + c + '">(' + s + ')</strong>'
        : '<strong style="color:' + c + '">' + s + '</strong>';
    }
    const neg = v < 0;
    const wrapped = neg ? '(' + s + ')' : s;
    const style = neg ? ' style="color:#dc2626"' : '';
    return bold
      ? '<strong' + style + '>' + wrapped + '</strong>'
      : '<span' + style + '>' + wrapped + '</span>';
  }

  // ── API-запросы через серверный прокси ─────────────────────────
  async function fetchAll(entity, extraParams) {
    const all = [];
    let page = 1;
    while (true) {
      const p = new URLSearchParams(Object.assign({ entity, limit: 100, page }, extraParams || {}));
      const r = await fetch('/api/data?' + p);
      if (!r.ok) throw new Error(entity + ' fetch failed: ' + r.status);
      const d = await r.json();
      if (d.error) throw new Error(entity + ': ' + JSON.stringify(d.error));
      const items = (d.response && d.response.items) || [];
      all.push(...items);
      const total = (d.response && d.response.total) || 0;
      if (all.length >= total || items.length < 100) break;
      page++;
    }
    return all;
  }

  async function fetchCategories() {
    const items = await fetchAll('categories');
    const map = {};
    items.forEach(function(c) { map[c.id] = c.name || ''; });
    return map;
  }

  async function fetchPlanMoney(curYear) {
    const items = await fetchAll('plan_money');
    return items.filter(function(i) {
      if (!i.plan_paid_date) return false;
      const iy = parseInt(i.plan_paid_date.substring(0, 4));
      return iy >= curYear && i.org_account_id === 36;
    });
  }

  async function fetchTxns(from, to) {
    // Используем стандартный API с фильтром по дате
    const items = await fetchAll('transaction', {
      'filter[date][start_date]': from,
      'filter[date][end_date]': to,
    });
    return items;
  }

  // ── Расчёт факта ───────────────────────────────────────────────
  function calcFact(txns, catMap, curYear, curMonth) {
    const acc = {};
    PROJECTS.forEach(function(p) {
      acc[p] = { i25: 0, e25: 0, i26: 0, e26: 0, iCur: 0, eCur: 0 };
    });

    txns.forEach(function(tx) {
      const dt = tx.date || '';
      const yr = parseInt(dt.slice(0, 4)) || 0;
      const mo = parseInt(dt.slice(5, 7)) || 0;
      if (yr !== curYear && yr !== curYear - 1) return;

      const incAmt = parseFloat(tx.income) || 0;
      const expAmt = parseFloat(tx.outcome) || 0;
      const typeName = catMap[tx.category_id] || '';
      const proj = PID_MAP[tx.project_id];
      if (!proj) return;

      const a = acc[proj];
      const isCur = yr === curYear && mo === curMonth;
      const isPrev = yr === curYear - 1;

      if (incAmt > 0 && isIncome(typeName)) {
        if (isPrev) a.i25 += incAmt;
        else { a.i26 += incAmt; if (isCur) a.iCur += incAmt; }
      }
      if (expAmt > 0 && isExpense(typeName, proj)) {
        if (isPrev) a.e25 += expAmt;
        else { a.e26 += expAmt; if (isCur) a.eCur += expAmt; }
      }
    });

    return acc;
  }

  // ── Расчёт плана ───────────────────────────────────────────────
  function calcPlan(planItems, curYear, curMonth) {
    const pm = {};
    PROJECTS.forEach(function(p) {
      pm[p] = { bi_plan: 0, be_plan: 0, hI: 0, hE: 0,
                plan_i: [0, 0, 0, 0, 0, 0], plan_e: [0, 0, 0, 0, 0, 0] };
    });

    planItems.forEach(function(item) {
      const proj = PID_MAP[item.project_id];
      if (!proj) return;
      const d = pm[proj];
      const iy = parseInt(item.plan_paid_date.substring(0, 4));
      const im = parseInt(item.plan_paid_date.substring(5, 7));
      const val = item.total || 0;
      const isI = item.type === 30, isE = item.type === 40;

      if (iy > curYear || (iy === curYear && im >= curMonth)) {
        if (isI) d.bi_plan += val;
        if (isE) d.be_plan += val;
      }
      if (iy === curYear && im === curMonth) {
        if (isI) d.hI += val;
        if (isE) d.hE += val;
      }
      if (iy === curYear && im >= 7 && im <= 12) {
        const idx = im - 7;
        if (isI) d.plan_i[idx] += val;
        if (isE) d.plan_e[idx] += val;
      }
    });

    return pm;
  }

  // ── Построение таблицы ─────────────────────────────────────────
  function buildTable(acc, pm, curYear, curMonth) {
    const curMon = MS[curMonth - 1];
    const prevYear = curYear - 1;
    const SEP  = ';border-left:2px solid #3d5c7a';
    const BT   = ';border-top:2px solid #c5cfe8';
    const BT2  = ';border-top:2px solid #4a6a8a';
    const BL2  = ';border-left:2px solid #4a6a8a';

    function TH(v, s)  { return '<th style="padding:5px 6px;text-align:right;border-bottom:2px solid #3d5c7a;font-size:10px;font-weight:600;white-space:nowrap' + (s||'') + '">' + v + '</th>'; }
    function THl(v, s) { return '<th style="padding:5px 6px;text-align:left;border-bottom:2px solid #3d5c7a;font-size:10px;font-weight:600' + (s||'') + '">' + v + '</th>'; }
    function TD(v, s)  { return '<td style="padding:2px 6px;text-align:right;border-bottom:1px solid #f0f0f0;white-space:nowrap' + (s||'') + '">' + v + '</td>'; }
    function TDl(v, s) { return '<td style="padding:2px 6px;border-bottom:1px solid #f0f0f0;white-space:nowrap' + (s||'') + '">' + v + '</td>'; }

    function getBudget(p, type) {
      var a = acc[p], d = pm[p];
      return type === 'inc'
        ? a.i25 + (a.i26 - a.iCur) + d.bi_plan
        : a.e25 + (a.e26 - a.eCur) + d.be_plan;
    }

    function totals(type) {
      var t = { b:0, f25:0, f26:0, fCur:0, fH:0, plan:[0,0,0,0,0,0] };
      PROJECTS.forEach(function(p) {
        var d = pm[p], a = acc[p];
        t.b   += getBudget(p, type);
        t.f25 += type === 'inc' ? a.i25  : a.e25;
        t.f26 += type === 'inc' ? a.i26  : a.e26;
        t.fCur+= type === 'inc' ? a.iCur : a.eCur;
        t.fH  += type === 'inc' ? d.hI   : d.hE;
        for (var i = 0; i < 6; i++)
          t.plan[i] += type === 'inc' ? d.plan_i[i] : d.plan_e[i];
      });
      t.fact = t.f25 + t.f26;
      t.ost  = t.b - t.fact;
      return t;
    }

    function pRow(p, type) {
      var d = pm[p], a = acc[p];
      var b    = getBudget(p, type);
      var f25  = type === 'inc' ? a.i25  : a.e25;
      var f26  = type === 'inc' ? a.i26  : a.e26;
      var fCur = type === 'inc' ? a.iCur : a.eCur;
      var h    = type === 'inc' ? d.hI   : d.hE;
      var plan = type === 'inc' ? d.plan_i : d.plan_e;
      var fact = f25 + f26, ost = b - fact;
      if (!b && !fact && plan.every(function(x){return !x;})) return '';
      return '<tr>'
        + TDl(p)
        + TD(fmtK(b), ';color:#9ca3af')
        + TD(fmtK(f25), SEP) + TD(fmtK(f26))
        + TD(fmtK(fact, true), ';font-weight:600')
        + TD(fmtK(ost), ost < 0 ? ';color:#dc2626' : '')
        + TD(fmtK(h), SEP) + TD(fmtK(fCur))
        + plan.map(function(v, i){ return TD(fmtK(v), i === 0 ? SEP : ''); }).join('')
        + '</tr>';
    }

    function totRow(label, t, bg) {
      bg = bg || '#eef2ff';
      var ost = t.b - t.fact;
      return '<tr style="background:' + bg + '">'
        + TDl('<strong>' + label + '</strong>', BT)
        + TD(fmtK(t.b, true), ';color:#9ca3af' + BT)
        + TD(fmtK(t.f25, true), SEP + BT) + TD(fmtK(t.f26, true), BT)
        + TD(fmtK(t.fact, true), BT)
        + TD(fmtK(ost, true), (ost < 0 ? ';color:#dc2626' : '') + BT)
        + TD(fmtK(t.fH, true), SEP + BT) + TD(fmtK(t.fCur, true), BT)
        + t.plan.map(function(v, i){ return TD(fmtK(v, true), (i === 0 ? SEP : '') + BT); }).join('')
        + '</tr>';
    }

    var ti = totals('inc'), te = totals('exp');
    var res = {
      b:    ti.b    - te.b,
      f25:  ti.f25  - te.f25,
      f26:  ti.f26  - te.f26,
      fact: ti.fact - te.fact,
      ost:  (ti.b - ti.fact) - (te.b - te.fact),
      fH:   ti.fH   - te.fH,
      fCur: ti.fCur - te.fCur,
      plan: ti.plan.map(function(v, i){ return v - te.plan[i]; }),
    };

    return '<table style="width:100%;border-collapse:collapse;font-size:11px">'
      + '<thead>'
      + '<tr style="background:#1e3a5f;color:#a8c4e0;font-size:9px">'
      + '<td style="padding:2px 6px;min-width:120px"></td><td></td>'
      + '<td colspan="4" style="padding:2px 6px;text-align:center;border-left:2px solid #3d5c7a">ФАКТ</td>'
      + '<td colspan="2" style="padding:2px 6px;text-align:center;border-left:2px solid #3d5c7a">Тек. месяц (' + curMon + ')</td>'
      + '<td colspan="6" style="padding:2px 6px;text-align:center;border-left:2px solid #3d5c7a">&#9658; План</td>'
      + '</tr>'
      + '<tr style="background:#1e3a5f;color:#fff">'
      + THl('Проект', ';min-width:120px;max-width:140px')
      + TH('Бюджет', ';color:#a8c4e0')
      + TH(prevYear, SEP + ';color:#a8c4e0')
      + TH(curYear + '<br><span style="font-weight:400;font-size:9px">янв–' + curMon.toLowerCase() + '</span>')
      + TH('Итого') + TH('Остаток')
      + TH('Бюджет', SEP) + TH('Факт')
      + PM_MONTHS.map(function(m, i){ return TH(m, i === 0 ? SEP : ''); }).join('')
      + '</tr>'
      + '</thead>'
      + '<tbody>'
      + '<tr style="background:#dce7f5"><td colspan="14" style="padding:4px 8px;font-weight:700;font-size:11.5px;color:#1e3a5f;border-bottom:1px solid #c5cfe8">ДОХОДЫ</td></tr>'
      + PROJECTS.map(function(p){ return pRow(p, 'inc'); }).join('')
      + totRow('ИТОГО ДОХОДЫ', ti)
      + '<tr style="background:#fae8e8"><td colspan="14" style="padding:4px 8px;font-weight:700;font-size:11.5px;color:#7f1d1d;border-bottom:1px solid #fca5a5">РАСХОДЫ</td></tr>'
      + PROJECTS.map(function(p){ return pRow(p, 'exp'); }).join('')
      + totRow('ИТОГО РАСХОДЫ', te, '#fef2f2')
      + '<tr style="background:#1e3a5f">'
      + TDl('<strong style="color:#fff">РЕЗУЛЬТАТ</strong>', BT2)
      + TD(fmtK(res.b, false, true), BT2)
      + TD(fmtK(res.f25, false, true), BL2 + BT2) + TD(fmtK(res.f26, false, true), BT2)
      + TD(fmtK(res.fact, false, true), BT2) + TD(fmtK(res.ost, false, true), BT2)
      + TD(fmtK(res.fH, false, true), BL2 + BT2) + TD(fmtK(res.fCur, false, true), BT2)
      + res.plan.map(function(v, i){ return TD(fmtK(v, false, true), (i === 0 ? BL2 : '') + BT2); }).join('')
      + '</tr>'
      + '</tbody></table>';
  }

  // ── Загрузка ───────────────────────────────────────────────────
  var loading = false;

  async function load() {
    if (loading) return;
    loading = true;
    var statusEl  = document.getElementById('status');
    var contentEl = document.getElementById('content');
    var now = new Date(), yr = now.getFullYear(), mo = now.getMonth() + 1;
    var from = (yr - 1) + '-01-01';
    var to   = yr + '-' + String(mo).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    statusEl.textContent = '&#9679; загрузка...';
    statusEl.style.color = '#d97706';
    contentEl.innerHTML = '<div style="padding:20px;text-align:center;color:#6b7280">&#8987; Загружаем данные...</div>';

    try {
      var t0 = Date.now();
      var results = await Promise.all([
        fetchTxns(from, to),
        fetchPlanMoney(yr),
        fetchCategories(),
      ]);
      var txns      = results[0];
      var planItems = results[1];
      var catMap    = results[2];

      var acc = calcFact(txns, catMap, yr, mo);
      var pm  = calcPlan(planItems, yr, mo);

      contentEl.innerHTML = buildTable(acc, pm, yr, mo);
      var elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      statusEl.innerHTML = '&#9679; live &middot; ' + now.toLocaleDateString('ru-RU') + ' &middot; ' + txns.length + '&nbsp;тр. &middot; ' + elapsed + 'с';
      statusEl.style.color = '#059669';
    } catch (err) {
      contentEl.innerHTML = '<div style="padding:16px;color:#dc2626">&#10060; Ошибка: ' + err.message + '</div>';
      statusEl.textContent = '&#9679; ошибка';
      statusEl.style.color = '#dc2626';
    }
    loading = false;
  }

  document.getElementById('refresh-btn').addEventListener('click', function() {
    loading = false;
    load();
  });

  load();
})();
</script>
</body>
</html>`;
