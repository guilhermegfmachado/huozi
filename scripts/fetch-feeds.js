#!/usr/bin/env node
// Runs in GitHub Actions: fetches all RSS feeds directly (no CORS) and writes data/feeds.json
const fs   = require('fs');
const path = require('path');

// Load FEEDS from feeds.js using new Function to handle const declarations
const feedsSrc = fs.readFileSync(path.join(__dirname, '../feeds.js'), 'utf8');
const FEEDS = (new Function(feedsSrc + '; return FEEDS;'))();

const TIMEOUT_MS = 12000;
const BATCH_SIZE = 8;

function parseItems(xml) {
  // Expand CDATA so tag regex works cleanly
  xml = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) =>
    c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  );

  const items  = [];
  const blockRe = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g;
  let m;
  while ((m = blockRe.exec(xml)) !== null) {
    const b   = m[1];
    const tag = (t) => {
      const r = new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i').exec(b);
      return r ? r[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').trim() : '';
    };
    const linkHref = (/<link[^>]+href=["']([^"']+)["']/i.exec(b) || [])[1] || '';
    items.push({
      title:       tag('title'),
      link:        linkHref || tag('link'),
      guid:        tag('guid') || tag('id') || linkHref || tag('link'),
      pubDate:     tag('pubDate') || tag('published') || tag('updated') || tag('date'),
      description: tag('description') || tag('content') || tag('summary') || '',
    });
  }
  return items;
}

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; huozi/1.0; RSS reader)' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    const items = parseItems(text);
    return items.length ? items : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function main() {
  console.log(`Fetching ${FEEDS.length} feeds in batches of ${BATCH_SIZE}...`);
  const results = {};
  let ok = 0, fail = 0;

  for (let i = 0; i < FEEDS.length; i += BATCH_SIZE) {
    const batch = FEEDS.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (f) => {
      const items = await fetchFeed(f);
      if (items) {
        results[f.id] = items;
        ok++;
        process.stdout.write(`  ✓ ${f.name} (${items.length})\n`);
      } else {
        fail++;
        process.stdout.write(`  ✗ ${f.name}\n`);
      }
    }));
  }

  console.log(`\n${ok} ok · ${fail} failed`);

  const outPath = path.join(__dirname, '../data/feeds.json');
  fs.writeFileSync(outPath, JSON.stringify({ updated: new Date().toISOString(), feeds: results }));
  console.log(`Written ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
