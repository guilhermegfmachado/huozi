// ─── OBSERVATORY ──────────────────────────────────────────────────────────────
// Categorised directory of live global data sources. Static links only — the
// entries come from data/observatory.json and nothing here calls an external API.
let _obsData    = null;  // { categories, entries }, null until loaded
let _obsFetch   = null;  // in-flight promise, so re-entering the section can't double-fetch
let _obsQuery   = '';

function loadObservatory() {
  if (!_obsFetch) {
    _obsFetch = fetch('./data/observatory.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => {
        _obsData = Array.isArray(d)
          ? { categories: [], entries: d }
          : { categories: d.categories || [], entries: d.entries || [] };
      })
      .catch(e => { _obsFetch = null; throw e; });  // clear so a retry can refetch
  }
  return _obsFetch;
}

// Host without the www. prefix — shown as muted text under each card.
function obsDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

async function renderObservatory() {
  const body = document.getElementById('observatory-body');
  if (!body) return;
  if (!_obsData) {
    // Painted before the first await: showSection() reveals the panel up front,
    // so without this the section sits blank for the length of the round trip.
    body.innerHTML = `<div class="state-row"><div class="spinner"></div> loading observatory…</div>`;
    try { await loadObservatory(); }
    catch {
      body.innerHTML = `<div class="empty-state">
        <div class="empty-icon">◐</div>could not load data/observatory.json</div>`;
      return;
    }
  }
  paintObservatory();
}

function paintObservatory() {
  const body = document.getElementById('observatory-body');
  if (!body || !_obsData) return;
  const all  = _obsData.entries;
  const q    = _obsQuery;
  const hits = q
    ? all.filter(e => `${e.name} ${e.description || ''}`.toLowerCase().includes(q))
    : all;

  const info = document.getElementById('obs-info');
  if (info) info.textContent = !all.length ? 'no entries yet'
    : q ? `${hits.length} of ${all.length} sources` : `${all.length} sources`;

  if (!all.length) {
    body.innerHTML = `<div class="empty-state"><div class="empty-icon">◐</div>
      no sources yet<br>add entries to data/observatory.json</div>`;
    return;
  }
  if (!hits.length) {
    body.innerHTML = `<div class="empty-state"><div class="empty-icon">◐</div>
      nothing matches “${esc(q)}”</div>`;
    return;
  }

  // Group by category, following the declared category order first so sections
  // keep a stable sequence; any unlisted category is appended in first-seen order.
  const groups = new Map();
  for (const c of _obsData.categories) groups.set(c, []);
  for (const e of hits) {
    const c = e.category || 'Other';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(e);
  }

  body.innerHTML = [...groups]
    .filter(([, items]) => items.length)
    .map(([cat, items]) => `<div class="obs-section">
      <div class="obs-cat-head">${esc(cat)}</div>
      <div class="obs-grid">
        ${items.map(i => {
          const domain = obsDomain(i.url);
          return `<div class="obs-card">
            <a class="obs-name" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.name)} ↗</a>
            ${i.description ? `<div class="obs-desc">${esc(i.description)}</div>` : ''}
            ${domain ? `<div class="obs-domain">${esc(domain)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

// The filter box lives in .sec-bar, so repainting .sec-body never destroys it —
// bound once here. No debounce, matching the #search listener in app.js.
document.getElementById('obs-filter')?.addEventListener('input', e => {
  _obsQuery = e.target.value.trim().toLowerCase();
  if (_obsData) paintObservatory();
});
