#!/usr/bin/env node
// Runs in GitHub Actions: fetches Yahoo Finance quotes server-side (no CORS)
// and writes data/prices.json. The client seeds its price cache from this file
// so portfolio/watchlist/screener load instantly without flaky CORS proxies.
//
// Ticker universe: data/tickers.json (if present) merged with DEFAULTS below.
// Users' custom tickers not in the universe still fall back to client-side fetch.
const fs   = require('fs');
const path = require('path');

const DEFAULTS = [
  'AAPL', 'MSFT', 'NVDA', 'NVO', 'LLY', 'FCX', 'VWCE.AS', '2330.TW', 'INDA',
  'GOOGL', 'AMZN', 'META', 'TSLA', 'BRK-B', 'ASML', 'TSM', 'V', 'JPM',
  'VUSA.AS', 'IWDA.AS', 'EMIM.AS', 'SPY', 'QQQ', 'VTI', 'GLD',
];

const TIMEOUT_MS = 10000;

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; huozi/1.0)' },
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.json();
  } catch { clearTimeout(timer); return null; }
}

async function fetchQuote(ticker) {
  const enc = encodeURIComponent(ticker);
  const d = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${enc}?interval=1d&range=1y`)
         || await fetchJson(`https://query2.finance.yahoo.com/v8/finance/chart/${enc}?interval=1d&range=1y`);
  const result = d?.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta;
  const closes = (result.indicators?.quote?.[0]?.close || []).filter(v => v != null);
  const price = meta.regularMarketPrice ?? closes[closes.length - 1] ?? null;
  const prev  = closes.length >= 2 ? closes[closes.length - 2]
              : meta.chartPreviousClose ?? meta.previousClose ?? price;
  return {
    price,
    prevClose: prev,
    change:    price != null && prev != null ? price - prev : null,
    changePct: price != null && prev ? ((price - prev) / prev) * 100 : null,
    high52:    meta.fiftyTwoWeekHigh ?? (closes.length ? Math.max(...closes) : null),
    low52:     meta.fiftyTwoWeekLow  ?? (closes.length ? Math.min(...closes) : null),
    currency:  meta.currency || 'USD',
    name:      meta.longName || meta.shortName || ticker,
  };
}

async function main() {
  let universe = [...DEFAULTS];
  const tickersPath = path.join(__dirname, '../data/tickers.json');
  if (fs.existsSync(tickersPath)) {
    try {
      const extra = JSON.parse(fs.readFileSync(tickersPath, 'utf8'));
      if (Array.isArray(extra)) universe.push(...extra);
    } catch {}
  }
  universe = [...new Set(universe.map(t => t.toUpperCase()))];

  console.log(`Fetching ${universe.length} tickers…`);
  const quotes = {};
  let ok = 0, fail = 0;
  // Sequential-ish batches to stay friendly to Yahoo
  const BATCH = 6;
  for (let i = 0; i < universe.length; i += BATCH) {
    await Promise.all(universe.slice(i, i + BATCH).map(async t => {
      const q = await fetchQuote(t);
      if (q && q.price != null) { quotes[t] = q; ok++; process.stdout.write(`  ✓ ${t} ${q.price}\n`); }
      else { fail++; process.stdout.write(`  ✗ ${t}\n`); }
    }));
  }
  console.log(`\n${ok} ok · ${fail} failed`);

  const outPath = path.join(__dirname, '../data/prices.json');
  fs.writeFileSync(outPath, JSON.stringify({ updated: new Date().toISOString(), quotes }));
  console.log(`Written ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
