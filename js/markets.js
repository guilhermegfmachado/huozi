// ─── SECTION STATE ────────────────────────────────────────────────────────────
const M = {
  portfolio: JSON.parse(localStorage.getItem('px_portfolio') || '[]'),
  watchlist: JSON.parse(localStorage.getItem('px_watchlist') || '[]'),
  alerts:    JSON.parse(localStorage.getItem('px_alerts')    || '[]'),
  portSort: { col: 'ticker', dir: 1 },
  wlSort:   { col: 'ticker', dir: 1 },
  prices: {},
  refreshTimer: null,
  currentSection: null,
};
const savePortfolio = () => localStorage.setItem('px_portfolio', JSON.stringify(M.portfolio));
const saveWatchlist = () => localStorage.setItem('px_watchlist', JSON.stringify(M.watchlist));
const saveAlerts    = () => localStorage.setItem('px_alerts',    JSON.stringify(M.alerts));

// ─── PORTFOLIO HISTORY CHART ──────────────────────────────────────────────────
function _renderPortfolioChart() {
  const hist = JSON.parse(localStorage.getItem('px_port_history') || '{}');
  const entries = Object.entries(hist).sort(([a],[b]) => a.localeCompare(b));
  if (entries.length < 2) return '';
  const vals = entries.map(([,v]) => v);
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const W = 500, H = 56, p = 3;
  const pts = entries.map(([,v], i) =>
    `${(p + (i / (entries.length - 1)) * (W - 2*p)).toFixed(1)},${(p + (1 - (v - min) / range) * (H - 2*p)).toFixed(1)}`
  ).join(' ');
  const gain = vals[vals.length - 1] - vals[0];
  const gainPct = vals[0] ? (gain / vals[0]) * 100 : 0;
  const col = gain >= 0 ? 'var(--accent)' : 'var(--red)';
  return `<div class="port-chart-wrap">
    <div class="port-chart-meta">
      <span>${entries.length}d history</span>
      <span class="${gain >= 0 ? 'p-gain' : 'p-loss'}">${fmtPct(gainPct)} · ${fmtSgn(gain)}</span>
    </div>
    <svg class="port-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
  </div>`;
}

// ─── PRICE FETCHING ───────────────────────────────────────────────────────────
const priceCache = {};

// Seed price cache from the GitHub-Actions snapshot (data/prices.json) so the
// portfolio/watchlist/screener paint instantly without any CORS proxy round-trip.
let _staticPricesLoaded = 0;
async function loadStaticPrices() {
  if (Date.now() - _staticPricesLoaded < 300000) return;
  try {
    const r = await fetch('./data/prices.json', { cache: 'no-cache' });
    if (!r.ok) return;
    const d = await r.json();
    const updated = new Date(d.updated).getTime();
    // Unknown timestamp ⇒ treat as a day old: still seeded, but live fetch wins
    const age = isNaN(updated) ? 86400000 : Math.max(0, Date.now() - updated);
    _staticPricesLoaded = Date.now();
    for (const [t, q] of Object.entries(d.quotes || {})) {
      const key = t.toUpperCase();
      if (priceCache[key] && Date.now() - priceCache[key].ts < age) continue;
      priceCache[key] = { ts: Date.now() - age, data: q };
    }
  } catch {}
}

// Yahoo Finance blocks direct browser CORS — try direct first, then fall back to
// two public CORS proxies so prices load in all environments.
// Each attempt is capped at 5s so a dead endpoint can't hang the UI.
async function _fetchJson(url) {
  const get = u => fetch(u, { signal: AbortSignal.timeout(5000) });
  try { const r = await get(url); if (r.ok) return await r.json(); } catch {}
  try {
    const r = await get(`https://corsproxy.io/?${encodeURIComponent(url)}`);
    if (r.ok) return await r.json();
  } catch {}
  try {
    const r = await get(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
    if (r.ok) { const d = await r.json(); return JSON.parse(d.contents); }
  } catch {}
  return null;
}

async function fetchPrice(ticker) {
  const key = ticker.toUpperCase();
  const cached = priceCache[key];
  if (cached && Date.now() - cached.ts < 300000) return cached.data;
  // Snapshot (GH Actions, every 15 min) under an hour old: serve it flagged,
  // skipping the CORS-proxy round-trip entirely
  if (cached && Date.now() - cached.ts < 3600000) return { ...cached.data, _snapshot: true };
  const d = await _fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?interval=1d&range=2d`
  ) || await _fetchJson(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?interval=1d&range=2d`
  );
  // Live fetch failed: an old snapshot beats an em-dash
  if (!d) return cached ? { ...cached.data, _snapshot: true } : null;
  const result = d.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta;
  const price = meta.regularMarketPrice ?? meta.previousClose ?? null;
  const prev  = meta.chartPreviousClose ?? meta.previousClose ?? price;
  const data  = {
    price, prevClose: prev,
    change:    price != null && prev != null ? price - prev : null,
    changePct: price != null && prev ? ((price - prev) / prev) * 100 : null,
    high52:    meta.fiftyTwoWeekHigh ?? null,
    low52:     meta.fiftyTwoWeekLow  ?? null,
    currency:  meta.currency || 'USD',
    name:      meta.longName || meta.shortName || key,
  };
  priceCache[key] = { ts: Date.now(), data };
  return data;
}

async function fetchFundamentals(ticker) {
  const key = ticker.toUpperCase();
  const ckey = key + '_fund';
  const cached = priceCache[ckey];
  if (cached && Date.now() - cached.ts < 300000) return cached.data;
  const d = await _fetchJson(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(key)}?modules=price,summaryDetail`
  );
  if (!d) return null;
  const res = d.quoteSummary?.result?.[0];
  if (!res) return null;
  const p = res.price || {}, s = res.summaryDetail || {};
  const data = {
    name:      p.longName || p.shortName || key,
    price:     p.regularMarketPrice?.raw ?? null,
    changePct: p.regularMarketChangePercent?.raw != null ? p.regularMarketChangePercent.raw * 100 : null,
    marketCap: p.marketCap?.raw ?? null,
    pe:        s.trailingPE?.raw ?? null,
    currency:  p.currency || 'USD',
  };
  priceCache[ckey] = { ts: Date.now(), data };
  return data;
}

// ─── PORTFOLIO ────────────────────────────────────────────────────────────────
let _portGen = 0; // drops stale async renders that finish after a newer one started
async function renderPortfolio() {
  const gen = ++_portGen;
  const tbody   = document.getElementById('port-tbody');
  const summary = document.getElementById('port-summary');
  const alloc   = document.getElementById('port-alloc');
  if (!M.portfolio.length) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
      <div class="empty-icon">▦</div>no holdings yet<br>click "+ add holding" to start</div></td></tr>`;
    if (summary) summary.innerHTML = '';
    if (alloc) alloc.innerHTML = '';
    document.getElementById('port-info').textContent = '0 holdings';
    return;
  }
  const tickers = [...new Set(M.portfolio.map(h => h.ticker))];
  // Only show the loading placeholder when no table is rendered yet —
  // re-renders (add/delete/refresh) keep the old rows until new data lands
  if (tbody && !tbody.querySelector('.col-ticker')) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:1.5rem;text-align:center;color:var(--text-dim)">loading prices…</td></tr>`;
  }
  await loadStaticPrices();
  const priceMap = {};
  await Promise.all(tickers.map(async t => { priceMap[t] = await fetchPrice(t); }));
  if (gen !== _portGen) return; // superseded
  M.prices = priceMap;
  _renderPortfolioTable(priceMap);
}

function _renderPortfolioTable(priceMap) {
  const tbody   = document.getElementById('port-tbody');
  const summary = document.getElementById('port-summary');
  const alloc   = document.getElementById('port-alloc');
  if (!tbody || !M.portfolio.length) { renderPortfolio(); return; }
  let totalValue = 0, totalCost = 0;
  const rows = M.portfolio.map(h => {
    const p        = priceMap[h.ticker];
    const price    = p?.price ?? null;
    const snapshot = p?._snapshot ?? false;
    const value    = price != null ? price * h.shares : null;
    const cost     = h.avgCost * h.shares;
    const gl       = value != null ? value - cost : null;
    const glPct    = value != null && cost ? ((value - cost) / cost) * 100 : null;
    if (value != null) totalValue += value;
    totalCost += cost;
    return { ...h, price, snapshot, value, cost, gl, glPct };
  });
  const { col, dir } = M.portSort;
  rows.sort((a, b) => {
    const av = a[col] ?? (dir > 0 ? Infinity : -Infinity);
    const bv = b[col] ?? (dir > 0 ? Infinity : -Infinity);
    return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * dir;
  });
  const hasPrices  = rows.some(r => r.price != null);
  const totalGL    = hasPrices ? totalValue - totalCost : null;
  const totalGLPct = hasPrices && totalCost ? (totalGL / totalCost) * 100 : null;
  summary.innerHTML = `
    <div class="port-card"><div class="port-card-label">total value</div>
      <div class="port-card-value">${hasPrices ? fmt(totalValue) : '—'}</div></div>
    <div class="port-card"><div class="port-card-label">total cost</div>
      <div class="port-card-value">${fmt(totalCost)}</div></div>
    <div class="port-card"><div class="port-card-label">gain / loss</div>
      <div class="port-card-value ${gainCls(totalGL)}">${fmtSgn(totalGL)}</div>
      <div class="port-card-sub ${gainCls(totalGLPct)}">${fmtPct(totalGLPct)}</div></div>
    <div class="port-card"><div class="port-card-label">holdings</div>
      <div class="port-card-value">${M.portfolio.length}</div></div>`;
  if (totalValue > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const hist = JSON.parse(localStorage.getItem('px_port_history') || '{}');
    hist[today] = totalValue;
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    for (const d of Object.keys(hist)) if (d < cutoff) delete hist[d];
    localStorage.setItem('px_port_history', JSON.stringify(hist));
  }
  const chartEl = document.getElementById('port-chart');
  if (chartEl) chartEl.innerHTML = _renderPortfolioChart();
  const allocRows = rows.filter(r => r.value != null).sort((a,b) => b.value - a.value);
  if (totalValue > 0 && allocRows.length) {
    alloc.innerHTML = `<div class="alloc-head">allocation</div>` +
      allocRows.map(r => {
        const pct = (r.value / totalValue) * 100;
        return `<div class="alloc-bar-row">
          <span class="alloc-ticker">${r.ticker}</span>
          <div class="alloc-track"><div class="alloc-fill" style="width:${pct.toFixed(1)}%"></div></div>
          <span class="alloc-pct">${pct.toFixed(1)}%</span></div>`;
      }).join('');
  } else alloc.innerHTML = '';
  tbody.innerHTML = rows.map(r => `<tr>
    <td class="col-ticker">${r.ticker}</td>
    <td class="col-num">${fmt(r.shares)}</td>
    <td class="col-num">${fmt(r.avgCost)}</td>
    <td class="col-num">${r.price != null ? fmt(r.price) + (r.snapshot ? '<span class="price-snapshot" title="daily snapshot price">*</span>' : '') : '—'}</td>
    <td class="col-num">${r.value != null ? fmt(r.value) : '—'}</td>
    <td class="col-num ${gainCls(r.gl)}">${r.gl != null ? fmtSgn(r.gl) : '—'}</td>
    <td class="col-num ${gainCls(r.glPct)}">${fmtPct(r.glPct)}</td>
    <td class="col-act">
      <button class="tbl-act-btn add-btn" onclick="addTickerToWatchlist('${r.ticker}')" title="add to watchlist">◉</button>
      <button class="tbl-act-btn" onclick="deleteHolding('${r.id}')" title="remove">✕</button>
    </td></tr>`).join('');
  document.getElementById('port-info').textContent =
    `${M.portfolio.length} holdings${hasPrices ? ' · ' + fmt(totalValue) : ''}`;
  document.querySelectorAll('#port-table th').forEach(th => {
    th.classList.remove('sorted');
    const oc = th.getAttribute('onclick') || '';
    if (oc.includes(`'${col}'`)) th.classList.add('sorted');
  });
}

async function refreshPortfolioPrices() {
  const tickers = [...new Set(M.portfolio.map(h => h.ticker))];
  tickers.forEach(t => delete priceCache[t.toUpperCase()]);
  const priceMap = {};
  await Promise.all(tickers.map(async t => { priceMap[t] = await fetchPrice(t); }));
  M.prices = priceMap;
  _renderPortfolioTable(priceMap);
}

function sortPort(col) {
  if (M.portSort.col === col) M.portSort.dir *= -1;
  else { M.portSort.col = col; M.portSort.dir = 1; }
  _renderPortfolioTable(M.prices);
}

function addHolding() {
  const ticker = (document.getElementById('pf-ticker').value || '').trim().toUpperCase();
  const shares = parseFloat(document.getElementById('pf-shares').value);
  const cost   = parseFloat(document.getElementById('pf-cost').value);
  const date   = document.getElementById('pf-date').value;
  if (!ticker || isNaN(shares) || isNaN(cost) || shares <= 0 || cost <= 0) {
    alert('Please fill ticker, shares, and avg cost.'); return;
  }
  M.portfolio.push({ id: uuid(), ticker, shares, avgCost: cost, purchaseDate: date });
  savePortfolio();
  ['pf-ticker','pf-shares','pf-cost','pf-date'].forEach(id => {
    document.getElementById(id).value = '';
  });
  toggleAddForm('port-form');
  renderPortfolio();
}

function deleteHolding(id) {
  M.portfolio = M.portfolio.filter(h => h.id !== id);
  savePortfolio();
  renderPortfolio();
}

function addTickerToWatchlist(ticker) {
  if (!M.watchlist.includes(ticker)) { M.watchlist.push(ticker); saveWatchlist(); }
}

// ─── WATCHLIST ────────────────────────────────────────────────────────────────
function _renderWLTable() {
  const tbody = document.getElementById('wl-tbody');
  if (!tbody || !M.watchlist.length) return;
  const { col, dir } = M.wlSort;
  const rows = M.watchlist.map(t => {
    const cached = priceCache[t.toUpperCase()];
    const p = cached && Date.now() - cached.ts < 300000 ? cached.data : null;
    return { ticker: t,
      price: p?.price ?? null, change: p?.change ?? null,
      changePct: p?.changePct ?? null, low52: p?.low52 ?? null, high52: p?.high52 ?? null };
  });
  rows.sort((a, b) => {
    const av = a[col] ?? (dir > 0 ? Infinity : -Infinity);
    const bv = b[col] ?? (dir > 0 ? Infinity : -Infinity);
    return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * dir;
  });
  tbody.innerHTML = rows.map(r => {
    const al = M.alerts.find(a => a.ticker === r.ticker);
    const badge = al
      ? `<span class="src-tag" style="border-color:#f5c54233;color:#f5c542;margin-left:0.3rem">${al.direction} ${fmt(al.targetPrice)}</span>` : '';
    return `<tr id="wl-row-${r.ticker.replace('.','_')}">
      <td class="col-ticker">${r.ticker}${badge}</td>
      <td class="col-num">${r.price != null ? fmt(r.price) : '—'}</td>
      <td class="col-num ${gainCls(r.change)}">${r.change != null ? fmtSgn(r.change) : '—'}</td>
      <td class="col-num ${gainCls(r.changePct)}">${fmtPct(r.changePct)}</td>
      <td class="col-num">${r.low52  != null ? fmt(r.low52)  : '—'}</td>
      <td class="col-num">${r.high52 != null ? fmt(r.high52) : '—'}</td>
      <td class="col-act">
        <button class="tbl-act-btn add-btn" onclick="openAlertForm('${r.ticker}')" title="set alert">⚑</button>
        <button class="tbl-act-btn add-btn" onclick="addToPortfolio('${r.ticker}')" title="add to portfolio">▦</button>
        <button class="tbl-act-btn" onclick="removeFromWatchlist('${r.ticker}')" title="remove">✕</button>
      </td></tr>`;
  }).join('');
  document.querySelectorAll('#wl-table th').forEach(th => {
    th.classList.remove('sorted');
    const oc = th.getAttribute('onclick') || '';
    if (oc.includes(`'${col}'`)) th.classList.add('sorted');
  });
  document.getElementById('wl-info').textContent = `${M.watchlist.length} tickers`;
}

function sortWL(col) {
  if (M.wlSort.col === col) M.wlSort.dir *= -1;
  else { M.wlSort.col = col; M.wlSort.dir = 1; }
  _renderWLTable();
}

let _wlGen = 0; // drops stale async renders that finish after a newer one started
async function renderWatchlist() {
  const gen = ++_wlGen;
  const tbody = document.getElementById('wl-tbody');
  if (!tbody) return;
  if (!M.watchlist.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      <div class="empty-icon">◉</div>no tickers yet<br>type a ticker above and press enter</div></td></tr>`;
    document.getElementById('wl-info').textContent = '0 tickers';
    return;
  }
  tbody.innerHTML = M.watchlist.map(t =>
    `<tr id="wl-row-${t.replace('.','_')}"><td class="col-ticker">${t}</td>
     <td class="col-num" colspan="5"><span class="p-flat">loading…</span></td><td></td></tr>`
  ).join('');
  document.getElementById('wl-info').textContent = `${M.watchlist.length} tickers`;
  await loadStaticPrices();
  await Promise.all(M.watchlist.map(async t => {
    const p = await fetchPrice(t);
    if (gen !== _wlGen) return;
    _updateWLRow(t, p);
    _checkAlerts(t, p);
  }));
  if (gen !== _wlGen) return; // superseded
  _renderWLTable();
}

function _updateWLRow(ticker, p) {
  const rowId = 'wl-row-' + ticker.replace('.','_');
  const row = document.getElementById(rowId);
  if (!row) return;
  const alert = M.alerts.find(a => a.ticker === ticker);
  const alertBadge = alert
    ? `<span class="src-tag" style="border-color:#f5c54233;color:#f5c542;margin-left:0.3rem">${alert.direction} ${fmt(alert.targetPrice)}</span>` : '';
  row.innerHTML = `
    <td class="col-ticker">${ticker}${alertBadge}</td>
    <td class="col-num">${p?.price != null ? fmt(p.price) : '—'}</td>
    <td class="col-num ${gainCls(p?.change)}">${p?.change != null ? fmtSgn(p.change) : '—'}</td>
    <td class="col-num ${gainCls(p?.changePct)}">${fmtPct(p?.changePct)}</td>
    <td class="col-num">${p?.low52  != null ? fmt(p.low52)  : '—'}</td>
    <td class="col-num">${p?.high52 != null ? fmt(p.high52) : '—'}</td>
    <td class="col-act">
      <button class="tbl-act-btn add-btn" onclick="openAlertForm('${ticker}')" title="set alert">⚑</button>
      <button class="tbl-act-btn add-btn" onclick="addToPortfolio('${ticker}')" title="add to portfolio">▦</button>
      <button class="tbl-act-btn" onclick="removeFromWatchlist('${ticker}')" title="remove">✕</button>
    </td>`;
}

function _checkAlerts(ticker, p) {
  if (!p?.price) return;
  const al = M.alerts.find(a => a.ticker === ticker);
  if (!al) return;
  const triggered = al.direction === 'below' ? p.price <= al.targetPrice : p.price >= al.targetPrice;
  if (triggered && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(`活字 — ${ticker} alert`, {
      body: `${ticker} is ${al.direction} ${fmt(al.targetPrice)} · current: ${fmt(p.price)}`,
    });
  }
}

async function refreshWatchlistPrices() {
  M.watchlist.forEach(t => delete priceCache[t.toUpperCase()]);
  await Promise.all(M.watchlist.map(async t => {
    const p = await fetchPrice(t);
    _updateWLRow(t, p);
    _checkAlerts(t, p);
  }));
  _renderWLTable();
}

function addToWatchlist() {
  const ticker = (document.getElementById('wl-ticker-in').value || '').trim().toUpperCase();
  if (!ticker) return;
  if (!M.watchlist.includes(ticker)) { M.watchlist.push(ticker); saveWatchlist(); }
  document.getElementById('wl-ticker-in').value = '';
  renderWatchlist();
}

function removeFromWatchlist(ticker) {
  M.watchlist = M.watchlist.filter(t => t !== ticker);
  M.alerts    = M.alerts.filter(a => a.ticker !== ticker);
  saveWatchlist(); saveAlerts();
  renderWatchlist();
}

function openAlertForm(ticker) {
  document.getElementById('al-ticker').value = ticker;
  document.getElementById('alert-form').classList.add('open');
  document.getElementById('al-price').focus();
}

function saveAlert() {
  const ticker = document.getElementById('al-ticker').value;
  const price  = parseFloat(document.getElementById('al-price').value);
  const dir    = document.getElementById('al-dir').value;
  if (!ticker || isNaN(price)) return;
  M.alerts = M.alerts.filter(a => a.ticker !== ticker);
  M.alerts.push({ ticker, targetPrice: price, direction: dir });
  saveAlerts();
  document.getElementById('alert-form').classList.remove('open');
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  renderWatchlist();
}

function addToPortfolio(ticker) {
  showSection('portfolio');
  setTimeout(() => {
    document.getElementById('pf-ticker').value = ticker;
    document.getElementById('port-form').classList.add('open');
  }, 50);
}

// ─── SCREENER ─────────────────────────────────────────────────────────────────
function renderScreener() {
  document.getElementById('scr-info').textContent = '';
}

async function runScreener() {
  const raw = document.getElementById('scr-tickers').value;
  const tickers = raw.split(/[\s,]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
  if (!tickers.length) return;
  const capFilter    = document.getElementById('scr-cap').value;
  const peMin        = parseFloat(document.getElementById('scr-pe-min').value) || null;
  const peMax        = parseFloat(document.getElementById('scr-pe-max').value) || null;
  const changeFilter = document.getElementById('scr-change').value;
  const status = document.getElementById('scr-status');
  const tbody  = document.getElementById('scr-tbody');
  status.textContent = `fetching ${tickers.length} tickers…`;
  tbody.innerHTML = `<tr><td colspan="7" style="padding:1.5rem;text-align:center;color:var(--text-dim)">loading…</td></tr>`;
  await loadStaticPrices();
  const results = await Promise.all(tickers.map(async t => {
    const base = priceCache[t.toUpperCase()]?.data;
    const d = await fetchFundamentals(t);
    return { ticker: t, ...(base || {}), ...(d || {}) };
  }));
  const filtered = results.filter(r => {
    if (capFilter === 'large' && (r.marketCap == null || r.marketCap < 10e9))  return false;
    if (capFilter === 'mid'   && (r.marketCap == null || r.marketCap < 2e9 || r.marketCap >= 10e9)) return false;
    if (capFilter === 'small' && (r.marketCap == null || r.marketCap >= 2e9))  return false;
    if (peMin != null && r.pe != null && r.pe < peMin) return false;
    if (peMax != null && r.pe != null && r.pe > peMax) return false;
    if (changeFilter === 'up'   && r.changePct != null && r.changePct <= 0) return false;
    if (changeFilter === 'down' && r.changePct != null && r.changePct >= 0) return false;
    return true;
  });
  status.textContent = `${filtered.length} of ${results.length} results`;
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:2rem;text-align:center;color:var(--text-dim)">no results match filters</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(r => `<tr>
    <td class="col-ticker">${r.ticker}</td>
    <td style="font-size:0.67rem;color:var(--text-dim);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name||'—'}</td>
    <td class="col-num">${r.price != null ? fmt(r.price) : '—'}</td>
    <td class="col-num ${gainCls(r.changePct)}">${fmtPct(r.changePct)}</td>
    <td class="col-num">${fmtCap(r.marketCap)}</td>
    <td class="col-num">${r.pe != null ? r.pe.toFixed(1) : '—'}</td>
    <td class="col-act">
      <button class="tbl-act-btn add-btn" onclick="addTickerToWatchlist('${r.ticker}');this.textContent='◉ added'" title="watchlist">◉</button>
      <button class="tbl-act-btn add-btn" onclick="addToPortfolio('${r.ticker}')" title="portfolio">▦</button>
    </td></tr>`).join('');
  document.getElementById('scr-info').textContent = `${filtered.length} results`;
}

// ─── SOURCES DIRECTORY ────────────────────────────────────────────────────────
function renderSources() {
  const body = document.getElementById('sources-body');
  if (!body) return;
  const regions = [
    { name:'Global VC / Startups', items:[
      {name:'TechCrunch',       url:'https://techcrunch.com'},
      {name:'The Information',  url:'https://theinformation.com'},
      {name:'Crunchbase News',  url:'https://news.crunchbase.com'},
      {name:'Sifted',           url:'https://sifted.eu'},
      {name:'StrictlyVC',       url:'https://strictlyvc.com'},
    ]},
    { name:'Asia / APAC', items:[
      {name:'Tech in Asia',     url:'https://techinasia.com'},
      {name:'KrASIA',           url:'https://kr-asia.com'},
      {name:'DealStreetAsia',   url:'https://dealstreetasia.com'},
      {name:'Rest of World',    url:'https://restofworld.org'},
      {name:'Nikkei Asia',      url:'https://asia.nikkei.com'},
    ]},
    { name:'China', items:[
      {name:'36Kr (English)',        url:'https://36kr.com/en'},
      {name:'Pandaily',              url:'https://pandaily.com'},
      {name:'Caixin Global',         url:'https://caixinglobal.com'},
      {name:'China Money Network',   url:'https://chinamoneynetwork.com'},
      {name:'S. China Morning Post', url:'https://scmp.com'},
    ]},
    { name:'India', items:[
      {name:'Inc42',     url:'https://inc42.com'},
      {name:'YourStory', url:'https://yourstory.com'},
      {name:'The Ken',   url:'https://the-ken.com'},
      {name:'Entrackr',  url:'https://entrackr.com'},
    ]},
    { name:'Latin America', items:[
      {name:'Contxto',    url:'https://contxto.com'},
      {name:'Latam List', url:'https://latamlist.com'},
    ]},
    { name:'Middle East / Africa', items:[
      {name:'Wamda',         url:'https://wamda.com'},
      {name:'Daily Maverick', url:'https://dailymaverick.co.za'},
      {name:'Disrupt Africa', url:'https://disruptafrica.com'},
    ]},
    { name:'Market Data / Tools', items:[
      {name:'Finviz',        url:'https://finviz.com'},
      {name:'TradingView',   url:'https://tradingview.com'},
      {name:'Koyfin',        url:'https://koyfin.com'},
      {name:'WhaleWisdom',   url:'https://whalewisdom.com'},
      {name:'Macrotrends',   url:'https://macrotrends.net'},
      {name:'TIKR',          url:'https://tikr.com'},
    ]},
    { name:'Research / Macro', items:[
      {name:'Our World in Data',    url:'https://ourworldindata.org'},
      {name:'World Bank Open Data', url:'https://data.worldbank.org'},
      {name:'Project Syndicate',    url:'https://project-syndicate.org'},
      {name:'VoxEU',                url:'https://cepr.org/voxeu'},
      {name:'IMF Blog',             url:'https://imf.org/en/Blogs'},
    ]},
  ];
  body.innerHTML = `<div class="sources-grid">` +
    regions.map(r => `<div class="source-region">
      <div class="source-region-head">${r.name}</div>
      ${r.items.map(i => `<div class="source-item">
        <span class="source-item-name">${i.name}</span>
        <a class="source-item-link" href="${i.url}" target="_blank" rel="noopener">↗ ${i.url.replace('https://','')}</a>
      </div>`).join('')}
    </div>`).join('') + `</div>`;
}

// Watchlist enter key
document.getElementById('wl-ticker-in').addEventListener('keydown', e => {
  if (e.key === 'Enter') addToWatchlist();
});

// Portfolio form: Enter submits from any field
['pf-ticker', 'pf-shares', 'pf-cost', 'pf-date'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') addHolding();
  });
});

// Alert form: Enter submits
document.getElementById('al-price')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') saveAlert();
});
