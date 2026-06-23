// ─── PROXY CASCADE ───────────────────────────────────────────────────────────
// Try each proxy in order; move to the next on any failure.
function _getText(el, ...tags) {
  for (const t of tags) {
    const found = el.getElementsByTagName(t)[0];
    if (found?.textContent?.trim()) return found.textContent.trim();
  }
  return '';
}
function parseRssXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('xml parse error');
  // Atom
  const entries = [...doc.getElementsByTagName('entry')];
  if (entries.length) return entries.map(e => ({
    title:   _getText(e, 'title'),
    link:    e.querySelector('link[rel="alternate"]')?.getAttribute('href')
             || e.querySelector('link:not([rel])')?.getAttribute('href')
             || e.querySelector('link')?.getAttribute('href') || '',
    guid:    _getText(e, 'id'),
    pubDate: _getText(e, 'published', 'updated'),
    description: _getText(e, 'content', 'summary'),
  }));
  // RSS 2.0 + RSS 1.0/RDF
  return [...doc.getElementsByTagName('item')].map(e => ({
    title:   _getText(e, 'title'),
    link:    _getText(e, 'link') || e.querySelector('link')?.getAttribute('href') || '',
    guid:    _getText(e, 'guid', 'link'),
    pubDate: _getText(e, 'pubDate', 'dc:date', 'date', 'published'),
    description: _getText(e, 'description', 'content:encoded', 'content'),
  }));
}
const PROXY_LIST = [
  {
    build: url => `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`,
    parse: async r => {
      const d = await r.json();
      if (d.status !== 'ok') throw new Error(d.message || 'rss2json error');
      return (d.items || []).map(i => ({
        title: i.title || '', link: i.link || '',
        guid: i.guid || i.link || '', pubDate: i.pubDate || '',
        description: i.description || '',
      }));
    },
  },
  {
    build: url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    parse: async r => { const d = await r.json(); if (!d.contents) throw new Error('empty'); return parseRssXml(d.contents); },
  },
  {
    build: url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    parse: async r => parseRssXml(await r.text()),
  },
];
// ─── STATE ───────────────────────────────────────────────────────────────────
const S = {
  articles: [],
  saved: new Set(JSON.parse(localStorage.getItem('px_saved') || '[]')),
  read:  new Set(JSON.parse(localStorage.getItem('px_read')  || '[]')),
  feed: 'all', sort: 'mixed',
  unread: localStorage.getItem('huozi-unread') === 'true',
  compact: localStorage.getItem('huozi-compact') === 'true',
  query: '', active: null, counts: {},
  fetchedCats: new Set(),
  cache: {},
  newsCat: 'all',
  updatedAt: null,
};
const saveSaved = () => localStorage.setItem('px_saved', JSON.stringify([...S.saved]));
const saveRead  = () => localStorage.setItem('px_read',  JSON.stringify([...S.read]));
// ─── UTILITY / DATE / FORMAT HELPERS → js/utils.js ──────────────────────────
// ─── SIDEBAR ─────────────────────────────────────────────────────────────────
function buildSidebar() {
  const cats = [
    { id: 'world-news',  label: 'World News',          icon: '◈' },
    { id: 'tech',        label: 'Technology',           icon: '◌' },
    { id: 'science',     label: 'Science',              icon: '◎' },
    { id: 'humanities',  label: 'Humanities & Culture', icon: '◇' },
    { id: 'economics',   label: 'Economics',            icon: '◫' },
    { id: 'investment',  label: 'Investment / VC',      icon: '▦' },
  ];
  const worldOrder = ['Europe','Americas','Asia-Pacific','MENA','Africa'];
  const vertOrder  = ['Analysis','Journalism','Institutional','Journals',
                      'Research','Preprints','Wire','Opinion','Blogs',
                      'Essays','Literature','History','Curated','Community','Africa'];
  document.getElementById('sb-regions').innerHTML = cats.map(cat => {
    const byRegion = {};
    for (const f of FEEDS.filter(f => f.cat === cat.id))
      (byRegion[f.region] = byRegion[f.region] || []).push(f);
    const order = cat.id === 'world-news' ? worldOrder : vertOrder;
    const regions = order.filter(r => byRegion[r]);
    return `
      <div class="sb-cat-block" data-cat="${cat.id}">
        <div class="sb-cat-header${cat.id === 'world-news' ? ' active' : ''}"
             onclick="toggleCatSection('${cat.id}')">
          <span>${cat.icon}</span>
          <span>${cat.label}</span>
          <span class="sb-cat-toggle" id="ct-${cat.id}">▸</span>
        </div>
        <div class="sb-cat-feeds collapsed" id="cf-${cat.id}">
          <div class="sb-item" data-id="${cat.id}" onclick="doSelect('${cat.id}')">
            <span class="sb-flag" style="opacity:0.4">—</span>
            <span class="sb-name" style="font-style:italic">all ${cat.label.toLowerCase()}</span>
          </div>
          ${regions.map(region => `
            <div class="sb-head">${region}</div>
            ${byRegion[region].map(f => `
              <div class="sb-item" data-id="${f.id}" onclick="doSelect('${f.id}')">
                <span class="sb-cc">${f.cc || '--'}</span>
                <span class="sb-name">${f.name}</span>
                <span class="sb-lang">${f.lang}</span>
                ${f.notes ? `<button class="sb-info-btn"
                  onmouseenter="showTooltip(event,'${f.id}')"
                  onmouseleave="hideTooltip()"
                  onclick="event.stopPropagation();showTooltip(event,'${f.id}')">?</button>` : ''}
                <span class="sb-count" id="c-${f.id}">·</span>
              </div>`).join('')}
          `).join('')}
        </div>
      </div>`;
  }).join('');
}
// ─── SIDEBAR DIRECTORY MODE ───────────────────────────────────────────────────
let sidebarMode = 'filter';
function toggleSidebarMode() {
  sidebarMode = sidebarMode === 'filter' ? 'directory' : 'filter';
  const btn = document.getElementById('sb-mode-toggle');
  btn.textContent = sidebarMode === 'filter' ? '⊞ directory' : '≡ filter';
  btn.classList.toggle('active', sidebarMode === 'directory');
  document.getElementById('sb-filter-content').style.display = sidebarMode === 'filter' ? '' : 'none';
  document.getElementById('sb-directory-content').style.display = sidebarMode === 'directory' ? '' : 'none';
  if (sidebarMode === 'directory') renderDirectoryMode();
}
function getHomepage(url) {
  try { return new URL(url).origin; } catch { return '#'; }
}
function renderDirectoryMode() {
  const body = document.getElementById('sb-directory-content');
  const GEO_REGIONS = ['Europe', 'Americas', 'Asia-Pacific', 'MENA', 'Africa'];
  // Only world-news feeds with geographic regions
  const byRegion = {};
  for (const f of FEEDS.filter(f => GEO_REGIONS.includes(f.region)))
    (byRegion[f.region] = byRegion[f.region] || []).push(f);
  const editorialOrder = ['wire', 'independent', 'state-funded', 'longform'];
  body.innerHTML = GEO_REGIONS.filter(r => byRegion[r]).map(region => `
    <div class="dir-region-head">${region}</div>
    ${byRegion[region].map(f => {
      const editorial = (f.tags || []).find(t => editorialOrder.includes(t)) || '';
      const homepage = getHomepage(f.url);
      return `<div class="dir-card" onclick="dirCardClick('${f.id}')">
        <div class="dir-card-top">
          <span class="dir-flag">${f.flag}</span>
          <span class="dir-name">${esc(f.name)}</span>
          <span class="dir-lang">${f.lang}</span>
          ${editorial ? `<span class="dir-tag ${editorial}">${editorial}</span>` : ''}
          <a class="dir-link" href="${homepage}" target="_blank" rel="noopener" onclick="event.stopPropagation()">↗</a>
        </div>
        ${f.notes ? `<span class="dir-notes">${esc(f.notes)}</span>` : ''}
      </div>`;
    }).join('')}
  `).join('');
}
function dirCardClick(feedId) {
  if (sidebarMode === 'directory') toggleSidebarMode();
  doSelect(feedId);
  // Expand the category section so the selected source is visible
  const feed = FEEDS.find(f => f.id === feedId);
  if (feed) {
    const catEl = document.getElementById('cf-' + feed.cat);
    if (catEl && catEl.classList.contains('collapsed')) toggleCatSection(feed.cat);
  }
}
function toggleCatSection(catId) {
  const feeds = document.getElementById('cf-' + catId);
  const toggle = document.getElementById('ct-' + catId);
  const isCollapsed = feeds.classList.toggle('collapsed');
  toggle.textContent = isCollapsed ? '▸' : '▾';
  if (!isCollapsed) {
    // close all other categories
    document.querySelectorAll('.sb-cat-feeds').forEach(el => {
      if (el.id !== 'cf-' + catId && !el.classList.contains('collapsed')) {
        el.classList.add('collapsed');
        const otherId = el.id.replace('cf-', '');
        const ot = document.getElementById('ct-' + otherId);
        if (ot) ot.textContent = '▸';
      }
    });
    if (!S.fetchedCats.has(catId)) loadCategory(catId, true);
  }
}
// ─── FETCH PROGRESS ──────────────────────────────────────────────────────────
let loadProgress = { done: 0, total: 0 };
function updateLoadingText() {
  const row = document.querySelector('#articles .state-row');
  if (row) {
    row.innerHTML = `<div class="spinner"></div> fetching feeds… ${loadProgress.done} / ${loadProgress.total}`;
  }
}
// ─── LOADING / FRESHNESS INDICATOR ───────────────────────────────────────────
// The top-bar dot reflects real state: amber-blink while fetching, solid green
// when data is live, calm grey at rest — no more permanent "loading" blink.
let _inflight = 0;
function loadStart() { _inflight++; refreshPulse(); }
function loadEnd()   { _inflight = Math.max(0, _inflight - 1); refreshPulse(); }
function refreshPulse() {
  const pulse = document.getElementById('pulse');
  const upd   = document.getElementById('updated');
  if (!pulse) return;
  if (_inflight > 0) {
    pulse.className = 'loading';
    if (upd && !S.updatedAt) upd.textContent = 'loading…';
  } else {
    pulse.className = S.updatedAt ? 'live' : '';
    if (upd && S.updatedAt) upd.textContent = relativeTime(new Date(S.updatedAt));
  }
}
function updateFeedInfo() {
  if (M.currentSection) return;
  const el = document.getElementById('feed-info');
  if (el && S.feed === 'all') {
    el.textContent = `${S.articles.length} articles · ${new Set(S.articles.map(a => a.feedId)).size} sources`;
  }
}
// ─── FETCH ───────────────────────────────────────────────────────────────────
function _mapItems(items, f) {
  return items.map(i => ({
    id:      i.guid || i.link || Math.random().toString(36),
    feedId:  f.id, cat: f.cat, name: f.name, flag: f.flag,
    cc:      f.cc || '--', lang: f.lang, region: f.region || '',
    title:   i.title || '',
    desc:    i.description ? stripHtml(i.description).slice(0, 400) : '',
    link:    i.link || '',
    date:    (() => { const d = parseDate(i.pubDate); return d ? d.getTime() : Date.now(); })(),
    readMin: Math.max(1, Math.round((i.description ? stripHtml(i.description).split(/\s+/).length : 50) / 200)),
  }));
}
async function fetchOne(f) {
  const tryProxy = proxy => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    return fetch(proxy.build(f.url), { signal: ctrl.signal })
      .then(r => { clearTimeout(timer); if (!r.ok) throw new Error('not ok'); return proxy.parse(r); })
      .then(items => _mapItems(items, f))
      .catch(e => { clearTimeout(timer); throw e; });
  };
  // Race all proxies simultaneously — first winner is used, rest are cancelled via GC
  return Promise.any(PROXY_LIST.map(tryProxy)).catch(() => null);
}
// Priority feeds loaded first for fast initial render
const PRIORITY = new Set(['bbc','guardian','nyt','ap','aljazeera','dw','ft','nhk']);
async function fetchBatch(feeds, trackProgress = false) {
  loadStart();
  const promises = feeds.map(f =>
    fetchOne(f).then(items => {
      if (trackProgress) { loadProgress.done++; updateLoadingText(); }
      const el = document.getElementById('c-' + f.id);
      if (items === null) {
        S.counts[f.id] = -1;
        if (el) { el.textContent = '✗'; el.classList.add('failed'); }
        return [];
      }
      S.counts[f.id] = items.length;
      if (el) { el.textContent = items.length || '·'; el.classList.remove('failed'); }
      return items;
    }).catch(() => {
      if (trackProgress) { loadProgress.done++; updateLoadingText(); }
      return [];
    })
  );
  let newArticles = (await Promise.all(promises)).flat();
  const existing = new Set(S.articles.map(a => a.title.toLowerCase().slice(0,50)));
  newArticles = newArticles.filter(a => {
    const k = a.title.toLowerCase().slice(0,50);
    if (existing.has(k)) return false;
    existing.add(k); return true;
  });
  S.articles.push(...newArticles);
  S.articles.sort((a,b) => b.date - a.date);
  IDB.putAll(newArticles).catch(() => {});
  S.updatedAt = Date.now();
  document.getElementById('c-all').textContent = S.articles.length;
  updateStats(); updateFeedInfo(); loadEnd();
  if (newArticles.length) maybeRender(); else hideNewPillIfIdle();
}
function hideNewPillIfIdle() { if (!_pendingRender) render(); }
async function loadCategory(cat, silent = false) {
  if (S.fetchedCats.has(cat) && cat !== 'all') return;
  S.fetchedCats.add(cat);
  const feeds = cat === 'all' ? FEEDS : FEEDS.filter(f => f.cat === cat);
  if (!silent) {
    loadProgress.done = 0;
    loadProgress.total = feeds.length;
    document.getElementById('articles').innerHTML =
      skeletonHTML(7, `fetching feeds… 0 / ${feeds.length}`);
  }
  if (cat === 'world-news') {
    // Load priority feeds first → fast first paint, then rest in background
    const priority = feeds.filter(f => PRIORITY.has(f.id));
    const rest = feeds.filter(f => !PRIORITY.has(f.id));
    await fetchBatch(priority, !silent);
    fetchBatch(rest, !silent); // background, no await
  } else {
    await fetchBatch(feeds, !silent);
  }
}
function refresh() {
  S.articles = [];
  S.fetchedCats = new Set();
  S.counts = {};
  // Reload the category the user is currently viewing, fall back to world-news
  const f = FEEDS.find(x => x.id === S.feed);
  const cat = CATS.has(S.feed) ? S.feed : (f ? f.cat : 'world-news');
  loadCategory(cat).then(() => {
    ['world-news','tech','science','humanities','economics','investment']
      .filter(c => c !== cat)
      .forEach(c => loadCategory(c, true));
  });
}
// ─── RENDER ───────────────────────────────────────────────────────────────────
const CATS = new Set(['world-news','tech','science','humanities','economics','investment']);
// Topic chips → feed categories. Geography (Asia, China, …) lives in the sidebar,
// so the top row stays one consistent dimension instead of mixing topic + place.
const NEWSCAT_CATS = {
  'world-news': ['world-news'],
  'business':   ['economics', 'investment'],
  'tech':       ['tech'],
  'science':    ['science'],
  'culture':    ['humanities'],
};
function visible() {
  let a = S.articles;
  if (S.feed === 'saved') {
    a = a.filter(x => S.saved.has(x.id));
  } else if (S.feed === 'all') {
    // show all fetched so far
  } else if (CATS.has(S.feed)) {
    a = a.filter(x => x.cat === S.feed);
  } else {
    a = a.filter(x => x.feedId === S.feed);
  }
  // Topic filter (chips) — maps to one or more feed categories
  if (S.newsCat && S.newsCat !== 'all') {
    const cats = NEWSCAT_CATS[S.newsCat];
    if (cats) a = a.filter(x => cats.includes(x.cat));
  }
  if (S.unread) a = a.filter(x => !S.read.has(x.id));
  if (S.query) { const q=S.query.toLowerCase(); a = a.filter(x => x.title.toLowerCase().includes(q)||x.desc.toLowerCase().includes(q)); }
  if (S.sort === 'source') {
    a = [...a].sort((x,y) => x.name.localeCompare(y.name));
    _clusterMap = new Map();
  } else if (S.sort === 'recent') {
    a = [...a].sort((x,y) => y.date - x.date);
    _clusterMap = new Map();
  } else {
    a = clusterArticles(interleave([...a]));
  }
  return a;
}
// ─── TOPIC CLUSTERING ─────────────────────────────────────────────────────────
// When several outlets cover the same story, fold them into one entry under the
// highest-ranked source with a "+N sources" affordance, instead of repeating
// near-identical headlines down the feed.
let _clusterMap = new Map(); // lead article id → [member articles]
const _STOPWORDS = new Set(('this that with from have will after over more than into amid says said ' +
  'what when where their about were been they would could should your some also just only most very ' +
  'much many other these those them then there here because while during before against between ' +
  'through under among within without being still make makes take takes back year years week weeks ' +
  'today first last news live update updates report').split(' '));
function _titleTokens(title) {
  return new Set(title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter(w => w.length >= 4 && !_STOPWORDS.has(w)));
}
function clusterArticles(list) {
  _clusterMap = new Map();
  const leads = [];          // { a, tokens }
  const wordIndex = new Map(); // token → lead indices
  const out = [];
  for (const a of list) {
    const tk = _titleTokens(a.title);
    let lead = null;
    if (tk.size >= 3) {
      // Count token overlap against existing leads via inverted index
      const overlap = new Map();
      for (const w of tk) for (const i of (wordIndex.get(w) || []))
        overlap.set(i, (overlap.get(i) || 0) + 1);
      for (const [i, n] of overlap) {
        const L = leads[i];
        if (a.feedId === L.a.feedId) continue;                    // same outlet ⇒ not a dupe story
        if (Math.abs(a.date - L.a.date) > 172800000) continue;    // > 48 h apart ⇒ different story
        const minSize = Math.min(tk.size, L.tokens.size);
        if (n >= 3 && n >= Math.ceil(minSize * 0.5)) { lead = L; break; }
      }
    }
    if (lead) {
      if (!_clusterMap.has(lead.a.id)) _clusterMap.set(lead.a.id, []);
      _clusterMap.get(lead.a.id).push(a);
    } else {
      const i = leads.length;
      leads.push({ a, tokens: tk });
      for (const w of tk) {
        if (!wordIndex.has(w)) wordIndex.set(w, []);
        wordIndex.get(w).push(i);
      }
      out.push(a);
    }
  }
  return out;
}
function toggleCluster(e, btn) {
  e.stopPropagation();
  const sub = btn.parentElement.nextElementSibling;
  if (!sub || !sub.classList.contains('cluster-sub')) return;
  const open = sub.classList.toggle('open');
  btn.textContent = open ? '▴ hide other coverage' : btn.dataset.label;
}
// ─── FEED ORDERING ────────────────────────────────────────────────────────────
// Tier 1 — global wire services and newspapers of record (hard news priority)
// Tier 2 — strong national papers and public broadcasters
// Default  1.0 — general quality sources
// < 1.0   — niche, curated, literary, or community aggregators
const SOURCE_WEIGHT = {
  reuters: 3.0, ap: 3.0, bbc: 2.8, nyt: 2.8, guardian: 2.5, economist: 2.5,
  aljazeera: 2.5, ft: 2.5, dw: 2.2, nhk: 2.2, npr: 2.2, rfi: 2.0,
  lemonde: 2.0, france24fr: 2.0, spiegel: 2.0, zeit: 1.8, nzz: 1.8,
  letemps: 1.8, scmp: 1.8, straits: 1.8, nikkei: 1.8, haaretz: 1.8,
  euronews: 1.6, dailymav: 1.6, folha: 1.5, lanacion: 1.5,
  // niche / curated / literary — visible via their own category, not in "all" lead
  aldaily: 0.4, laphams: 0.4, 'paris-rev': 0.45, aeon: 0.5, berfrois: 0.45,
  lithub: 0.5, eurozine: 0.5, 'public-dom': 0.45, 'jstor-daily': 0.5, '3qd': 0.5,
  hn: 0.6, schneier: 0.7,
};
function decayScore(article) {
  const hoursOld = (Date.now() - article.date) / 3_600_000;
  const w = SOURCE_WEIGHT[article.feedId] ?? 1.0;
  return w / Math.pow(hoursOld + 2, 1.4);
}
function interleave(articles) {
  const bySource = {};
  for (const a of articles) {
    if (!bySource[a.feedId]) bySource[a.feedId] = [];
    bySource[a.feedId].push(a);
  }
  for (const q of Object.values(bySource)) q.sort((a,b) => decayScore(b) - decayScore(a));
  const queues = Object.values(bySource).sort((a,b) => decayScore(b[0]) - decayScore(a[0]));
  const result = [];
  let active = queues.filter(q => q.length > 0);
  while (active.length > 0) {
    for (const q of active) if (q.length) result.push(q.shift());
    active = active.filter(q => q.length > 0);
  }
  return result;
}
function articleHTML(a, isSub = false) {
  const isSaved = S.saved.has(a.id);
  const langBadge = a.lang !== 'en'
    ? `<span class="a-lang">${a.lang}</span>` : '';
  const xlateAction = a.lang !== 'en'
    ? `<button class="a-action-btn" data-title="${esc(a.title)}" data-lang="${a.lang}"
         onclick="event.stopPropagation();inlineXlate(this,this.dataset.title,this.dataset.lang)">⟳ translate</button>` : '';
  const members = !isSub ? (_clusterMap.get(a.id) || []) : [];
  const clusterBadge = members.length
    ? `<span class="a-cluster-badge">▣ ${members.length + 1} sources</span>` : '';
  const clusterBlock = members.length ? (() => {
    const names = [...new Set(members.map(m => m.name))];
    const label = `▾ also: ${names.slice(0, 3).join(' · ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`;
    return `
      <div class="cluster-row">
        <button class="a-action-btn cluster-toggle" data-label="${esc(label)}"
          onclick="toggleCluster(event,this)">${esc(label)}</button>
      </div>
      <div class="cluster-sub">${members.map(m => articleHTML(m, true)).join('')}</div>`;
  })() : '';
  return `<div class="article${isSub?' sub':''}${S.read.has(a.id)?' read':''}${S.active===a.id?' active':''}"
               data-id="${esc(a.id)}"
               onclick="event.stopPropagation();openReader(this.dataset.id)">
    <div class="a-meta">
      <span class="a-src">${esc(a.name)}</span>
      ${langBadge}
      ${clusterBadge}
      <span class="a-time" data-ts="${a.date}" title="${formatAbsolute(new Date(a.date))}"
            onclick="event.stopPropagation();flashTimestamp(this)">${relativeTime(new Date(a.date))}</span>
    </div>
    <div class="a-title">${esc(a.title)}</div>
    ${isSub ? '' : `<div class="a-desc">${esc(a.desc)}</div>`}
    <div class="a-actions">
      <button class="a-action-btn${isSaved?' saved':''}"
        onclick="event.stopPropagation();toggleSave(this.closest('[data-id]').dataset.id)">${isSaved?'◆ saved':'◇ save'}</button>
      <span class="a-dot">·</span>
      <a class="a-open-link" href="${esc(a.link)}" target="_blank" rel="noopener"
        onclick="event.stopPropagation()">↗ open</a>
      ${xlateAction ? `<span class="a-dot">·</span>${xlateAction}` : ''}
    </div>
    ${clusterBlock}
  </div>`;
}
// Incremental rendering: build the first chunk synchronously, append the rest
// as the user scrolls — keeps the DOM small with 800+ articles loaded.
const RENDER_CHUNK = 60;
let _renderList = [], _renderedCount = 0;
function _appendChunk() {
  const wrap = document.getElementById('articles');
  const slice = _renderList.slice(_renderedCount, _renderedCount + RENDER_CHUNK);
  if (!slice.length) return;
  _renderedCount += slice.length;
  wrap.insertAdjacentHTML('beforeend', slice.map(a => articleHTML(a)).join(''));
}
function render() {
  const list = visible();
  const wrap = document.getElementById('articles');
  wrap.className = S.compact ? 'compact' : '';
  hideNewPill();
  if (!list.length) { wrap.innerHTML = '<div id="empty">no articles</div>'; _renderList = []; return; }
  _renderList = list;
  _renderedCount = 0;
  wrap.innerHTML = '';
  _appendChunk();
}
document.getElementById('articles').addEventListener('scroll', function () {
  if (_renderedCount < _renderList.length &&
      this.scrollTop + this.clientHeight > this.scrollHeight - 600) {
    _appendChunk();
  }
});
// ─── NEW-ARTICLES PILL ────────────────────────────────────────────────────────
// Background refresh shouldn't reorder the list under the reader's thumb.
// If they've scrolled, hold the re-render and offer a tap-to-refresh pill.
let _pendingRender = false;
function maybeRender() {
  const wrap = document.getElementById('articles');
  if (!M.currentSection && wrap && wrap.scrollTop > 300 && _renderList.length) {
    _pendingRender = true;
    const pill = document.getElementById('new-pill');
    if (pill) pill.classList.add('show');
  } else {
    render();
  }
}
function hideNewPill() {
  _pendingRender = false;
  document.getElementById('new-pill')?.classList.remove('show');
}
function applyPendingRender() {
  render();
  document.getElementById('articles').scrollTop = 0;
}
// ─── SKELETON LOADING ─────────────────────────────────────────────────────────
function skeletonHTML(n = 7, progressText = 'fetching feeds…') {
  return `<div class="state-row"><div class="spinner"></div> ${progressText}</div>` +
    Array.from({ length: n }, () => `<div class="sk-card">
      <div class="sk-line" style="width:34%"></div>
      <div class="sk-line bright" style="width:88%"></div>
      <div class="sk-line" style="width:64%"></div>
    </div>`).join('');
}
// ─── CONTROLS ────────────────────────────────────────────────────────────────
function doSelect(id) {
  // If coming from a section panel, restore news view
  if (M.currentSection) showNews();
  S.feed = id;
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
  const mt = document.getElementById('mob-toggle');
  if (mt) mt.textContent = '☰'; // keep minimal
  document.querySelectorAll('.sb-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === id));
  const f = FEEDS.find(x => x.id === id);
  const catLabels = {
    'world-news': 'world news', 'tech': 'technology',
    'science': 'science', 'humanities': 'humanities & culture',
    'economics': 'economics', 'investment': 'investment / vc'
  };
  if (id === 'all') {
    document.getElementById('feed-name').textContent = '';
    document.getElementById('feed-info').textContent =
      `${S.articles.length} articles · ${FEEDS.length} sources`;
  } else if (id === 'saved') {
    document.getElementById('feed-name').textContent = 'saved';
    document.getElementById('feed-info').textContent = `${S.saved.size} saved`;
  } else if (catLabels[id]) {
    document.getElementById('feed-name').textContent = catLabels[id];
    const catArticles = S.articles.filter(x => x.cat === id);
    const catFeeds = FEEDS.filter(x => x.cat === id);
    document.getElementById('feed-info').textContent =
      `${catArticles.length} articles · ${catFeeds.length} sources`;
    if (!S.fetchedCats.has(id)) { loadCategory(id); return; }
  } else {
    document.getElementById('feed-name').textContent = f?.name || id;
    document.getElementById('feed-info').textContent = `${S.counts[id] || 0} articles`;
    if (f && !S.fetchedCats.has(f.cat)) { loadCategory(f.cat); return; }
  }
  render();
}
function doSort(s) {
  S.sort = s;
  document.getElementById('s-mixed').classList.toggle('on',  s==='mixed');
  document.getElementById('s-recent').classList.toggle('on', s==='recent');
  document.getElementById('s-source').classList.toggle('on', s==='source');
  render();
}
function markAllRead() {
  visible().forEach(a => S.read.add(a.id));
  saveRead(); updateStats(); render();
}
function toggleUnread()  {
  S.unread=!S.unread;  localStorage.setItem('huozi-unread',S.unread);
  document.getElementById('btn-unread')?.classList.toggle('on',S.unread);
  document.getElementById('sb-btn-unread')?.classList.toggle('on',S.unread);
  render();
}
function toggleCompact() {
  S.compact=!S.compact; localStorage.setItem('huozi-compact',S.compact);
  document.getElementById('sb-btn-compact')?.classList.toggle('on',S.compact);
  render();
}
function doRefresh() { refresh(); }
function updateStats() {
  ['st-a','st-s','st-l'].forEach(id => document.getElementById(id).classList.remove('stat-loading'));
  document.getElementById('st-a').textContent = S.articles.length;
  document.getElementById('st-s').textContent = new Set(S.articles.map(a=>a.feedId)).size;
  document.getElementById('st-l').textContent = new Set(S.articles.map(a=>a.lang)).size;
  document.getElementById('st-r').textContent = S.read.size;
  const cSaved = document.getElementById('c-saved');
  cSaved.textContent = S.saved.size;
  cSaved.classList.toggle('has-saved', S.saved.size > 0);
}
// ─── SAVED DROPDOWN ───────────────────────────────────────────────────────────
function toggleSavedDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('saved-dropdown');
  if (dd.style.display === 'block') { dd.style.display = 'none'; return; }
  if (S.saved.size === 0) return;
  const savedArticles = S.articles.filter(a => S.saved.has(a.id));
  if (!savedArticles.length) return;
  dd.innerHTML = savedArticles.map(a =>
    `<div class="saved-dd-item" data-id="${esc(a.id)}" onclick="event.stopPropagation();openReader(this.dataset.id);document.getElementById('saved-dropdown').style.display='none'">${esc(a.title)}</div>`
  ).join('');
  const rect = document.getElementById('c-saved').getBoundingClientRect();
  const ddW = 260;
  const left = Math.min(rect.right + 6, window.innerWidth - ddW - 8);
  dd.style.left = Math.max(8, left) + 'px';
  dd.style.top  = Math.min(rect.top, window.innerHeight - 300) + 'px';
  dd.style.display = 'block';
}
document.addEventListener('click', () => {
  const dd = document.getElementById('saved-dropdown');
  if (dd) dd.style.display = 'none';
  hideTooltip();
});
function toggleSave(id) {
  if (S.saved.has(id)) { S.saved.delete(id); } else { S.saved.add(id); }
  saveSaved();
  const cSaved = document.getElementById('c-saved');
  cSaved.textContent = S.saved.size;
  cSaved.classList.toggle('has-saved', S.saved.size > 0);
  // update the button in place without full re-render
  const card = document.querySelector(`.article[data-id="${id}"] .a-action-btn`);
  if (card) {
    const now = S.saved.has(id);
    card.classList.toggle('saved', now);
    card.textContent = now ? '◆ saved' : '◇ save';
  }
  // also update reader save button if open
  const rBtn = document.getElementById('r-save-btn');
  if (rBtn && S.active === id) {
    const now = S.saved.has(id);
    rBtn.classList.toggle('saved', now);
    rBtn.textContent = now ? '◆ saved' : '◇ save';
  }
}
// ─── READER ───────────────────────────────────────────────────────────────────
function openReader(id) {
  const a = S.articles.find(x => x.id===id); if (!a) return;
  S.active = id; S.read.add(id); saveRead();
  document.getElementById('st-r').textContent = S.read.size;
  document.querySelectorAll('.article').forEach(el => {
    el.classList.toggle('active', el.dataset.id===id);
    if (el.dataset.id===id) el.classList.remove('read');
  });
  const readerEl = document.getElementById('reader');
  if (window.innerWidth <= 960) readerEl.classList.add('show-mobile');
  document.getElementById('r-flag').textContent = a.flag;
  document.getElementById('r-src').textContent  = a.name;
  const rTimeEl = document.getElementById('r-time');
  rTimeEl.textContent = ' · ' + relativeTime(new Date(a.date));
  rTimeEl.title = formatAbsolute(new Date(a.date));
  rTimeEl.dataset.ts = a.date;
  document.getElementById('r-title').textContent = a.title;
  document.getElementById('r-date').textContent  = formatAbsolute(new Date(a.date));
  document.getElementById('r-desc').textContent  = a.desc||'—';
  document.getElementById('r-xlated').className = '';
  document.getElementById('r-xlated').textContent = '';
  document.getElementById('r-xlate-btn').textContent = '⟳ translate to english';
  document.getElementById('r-xlate-wrap').style.display = a.lang!=='en' ? '' : 'none';

  // full article link
  document.getElementById('r-full-link').href = a.link;

  // source notes
  const feed = FEEDS.find(f => f.id === a.feedId);
  document.getElementById('r-src-notes-text').textContent = feed?.notes || '';
  document.getElementById('r-src-tags').innerHTML = (feed?.tags||[]).map(t =>
    `<span class="src-tag ${t}">${t}</span>`
  ).join('');

  const isSaved = S.saved.has(id);
  const rSave = document.getElementById('r-save-btn');
  rSave.classList.toggle('saved', isSaved);
  rSave.textContent = isSaved ? '◆ saved' : '◇ save';
  document.getElementById('reader').classList.remove('hide');
}
function closeReader() {
  const r = document.getElementById('reader');
  r.classList.add('hide');
  r.classList.remove('show-mobile');
  S.active=null;
  document.querySelectorAll('.article.active').forEach(el => el.classList.remove('active'));
}
function openLink() { const a=S.articles.find(x=>x.id===S.active); if(a) window.open(a.link,'_blank','noopener'); }
// ─── TRANSLATION ─────────────────────────────────────────────────────────────
async function xlate(text, from='auto') {
  try {
    const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=en&dt=t&q=${encodeURIComponent(text)}`);
    const d = await r.json();
    return d[0].map(s=>s[0]).join('');
  } catch { return null; }
}
async function translateReader() {
  const a=S.articles.find(x=>x.id===S.active); if(!a) return;
  const btn=document.getElementById('r-xlate-btn');
  btn.textContent='⟳ translating…';
  const res=await xlate(a.title+'\n\n'+a.desc, a.lang);
  if (res) { document.getElementById('r-xlated').textContent=res; document.getElementById('r-xlated').className='show'; btn.textContent='✓ translated'; }
  else btn.textContent='✗ failed';
}
async function inlineXlate(btn, title, lang) {
  btn.textContent='⟳ …';
  const res=await xlate(title, lang);
  if (res) { btn.textContent=res; btn.style.opacity='1'; btn.style.color='var(--text-dim)'; btn.onclick=null; }
  else btn.textContent='✗';
}

// ─── MOBILE SIDEBAR ──────────────────────────────────────────────────────────
function toggleMobileSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  const open = sb.classList.toggle('open');
  ov.classList.toggle('open', open);
  const tog = document.getElementById('mob-toggle');
  tog.textContent = open ? '✕' : '☰';
  tog.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
}
// ─── SOURCE TOOLTIP ─────────────────────────────────────────────────────────────
function showTooltip(e, feedId) {
  const f = FEEDS.find(x => x.id === feedId);
  if (!f) return;
  const tt = document.getElementById('src-tooltip');
  document.getElementById('tt-name').textContent = f.name;
  document.getElementById('tt-notes').textContent = f.notes || '';
  document.getElementById('tt-tags').innerHTML = (f.tags||[]).map(t =>
    `<span class="src-tag ${t}">${t}</span>`
  ).join('');
  // position to the right of the sidebar
  const rect = e.target.getBoundingClientRect();
  tt.style.left = (rect.right + 8) + 'px';
  tt.style.top  = Math.min(rect.top, window.innerHeight - 160) + 'px';
  tt.classList.add('show');
}
function hideTooltip() {
  document.getElementById('src-tooltip').classList.remove('show');
}
// ─── KEYBOARD ─────────────────────────────────────────────────────────────────
const searchEl = document.getElementById('search');
searchEl.addEventListener('input', e => { S.query=e.target.value.trim(); render(); });
function noInput() {
  const t = document.activeElement?.tagName;
  return t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT';
}
function toggleShortcuts() {
  document.getElementById('shortcuts-overlay').classList.toggle('show');
}
function navArticle(dir) {
  const list = visible();
  if (!list.length) return;
  const idx = S.active ? list.findIndex(a => a.id === S.active) : -1;
  const next = list[Math.max(0, Math.min(list.length - 1, idx + dir))];
  if (next) openReader(next.id);
}
document.addEventListener('keydown', e => {
  if (e.key==='/' && document.activeElement!==searchEl) { e.preventDefault(); searchEl.focus(); return; }
  if (e.key==='Escape') {
    if (document.activeElement===searchEl) { searchEl.blur(); return; }
    if (document.getElementById('shortcuts-overlay').classList.contains('show')) { toggleShortcuts(); return; }
    closeReader(); return;
  }
  if (!noInput()) return;
  switch(e.key) {
    case 'j': case 'ArrowDown': e.preventDefault(); navArticle(1);  break;
    case 'k': case 'ArrowUp':   e.preventDefault(); navArticle(-1); break;
    case 'o': if (S.active) openLink(); break;
    case 's': if (S.active) toggleSave(S.active); break;
    case 'u': toggleUnread(); break;
    case 'r': doRefresh(); break;
    case '?': toggleShortcuts(); break;
  }
});
// ─── THEME ────────────────────────────────────────────────────────────────────
function initTheme() {
  // Theme already applied by inline script in <head> — just sync the button
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  document.getElementById('btn-theme').textContent = theme === 'dark' ? '☀' : '◑';
  document.getElementById('meta-theme-color')?.setAttribute('content', theme === 'dark' ? '#0c0c0c' : '#f7f5f0');
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('px_theme', next);
  document.getElementById('btn-theme').textContent = next === 'dark' ? '☀' : '◑';
  document.getElementById('meta-theme-color')?.setAttribute('content', next === 'dark' ? '#0c0c0c' : '#f7f5f0');
}
// (M, savePortfolio/Watchlist/Alerts, priceCache, price fetching,
//  portfolio, watchlist, screener, sources → js/markets.js)
// ─── INIT ─────────────────────────────────────────────────────────────────────
function updateTimestamps() {
  document.querySelectorAll('[data-ts]').forEach(el => {
    const ts = parseInt(el.dataset.ts, 10);
    if (!ts) return;
    const d = new Date(ts);
    const rel = relativeTime(d);
    if (el.id === 'r-time') {
      el.textContent = ' · ' + rel;
    } else {
      el.textContent = rel;
    }
  });
}
setInterval(updateTimestamps, 60000);
function flashTimestamp(el) {
  const ts = parseInt(el.dataset.ts, 10);
  if (!ts) return;
  el.textContent = formatAbsolute(new Date(ts));
  setTimeout(() => { el.textContent = relativeTime(new Date(ts)); }, 2500);
}
initTheme();
buildSidebar();
document.getElementById('feed-name').textContent = '';
document.getElementById('btn-unread')?.classList.toggle('on', S.unread);
document.getElementById('sb-btn-unread')?.classList.toggle('on', S.unread);
document.getElementById('sb-btn-compact')?.classList.toggle('on', S.compact);

// ─── STARTUP: cache paint → static file → fill gaps → proxy fallback ─────────
// 1. Instant paint from IndexedDB cache (no network) so the page is never blank.
async function paintFromCache() {
  try {
    const cached = await IDB.getRecent(86400000); // up to 24h old
    if (!cached.length || S.articles.length) return;
    S.articles = cached.sort((a, b) => b.date - a.date);
    document.getElementById('c-all').textContent = S.articles.length;
    updateStats(); render(); updateFeedInfo();
  } catch {}
}
// 2. Load the GitHub-Actions pre-fetched file. Same-origin + conditional cache
//    (no Date.now() buster) means repeat visits revalidate cheaply (304) instead
//    of re-downloading the whole payload every time.
let _staticLoaded = false;
// Static file is the primary data source. Returns 'fresh' | 'stale' | false.
// Stale data still paints (better than blank) — proxies then top it up.
async function tryStaticFeeds() {
  loadStart();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch('./data/feeds.json', { cache: 'no-cache', signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return false;
    const d = await r.json();
    const age = Date.now() - new Date(d.updated).getTime();
    if (!Object.keys(d.feeds).length) return false;
    const isFresh = age < 7200000; // < 2 h with a 15-min cron ⇒ comfortably fresh
    const fresh = [];
    for (const [feedId, items] of Object.entries(d.feeds)) {
      const feed = FEEDS.find(f => f.id === feedId);
      if (!feed) continue;
      const mapped = _mapItems(items, feed);
      S.counts[feedId] = mapped.length;
      S.fetchedCats.add(feed.cat);
      const el = document.getElementById('c-' + feedId);
      if (el) { el.textContent = mapped.length || '·'; el.classList.remove('failed'); }
      fresh.push(...mapped);
    }
    if (!fresh.length) return false;
    // Fresh server data is authoritative; keep any cache-painted extras, deduped.
    const seen = new Set();
    S.articles = fresh.concat(S.articles).filter(a => {
      const k = a.title.toLowerCase().slice(0, 50);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    S.articles.sort((a, b) => b.date - a.date);
    S.updatedAt = new Date(d.updated).getTime();
    _staticLoaded = true;
    document.getElementById('c-all').textContent = S.articles.length;
    updateStats(); render(); updateFeedInfo();
    IDB.putAll(fresh).catch(() => {});
    return isFresh ? 'fresh' : 'stale';
  } catch { return false; }
  finally { loadEnd(); }
}
// 3. Some sources fail server-side — fetch just those via the proxy cascade,
//    quietly in the background, so coverage approaches 100% without blocking paint.
function backgroundFillMissing() {
  const missing = FEEDS.filter(f => !S.counts[f.id] || S.counts[f.id] < 1);
  if (missing.length) fetchBatch(missing); // silent; merges + dedups
}
// 4. No usable static data at all → full proxy cascade (priority first).
//    force=true tops up stale static data quietly without wiping the paint.
function fullProxyFallback(force = false) {
  if (!force && S.fetchedCats.has('world-news')) return;
  if (force) {
    const priority = FEEDS.filter(f => PRIORITY.has(f.id));
    const rest = FEEDS.filter(f => !PRIORITY.has(f.id));
    fetchBatch(priority).then(() => fetchBatch(rest));
    return;
  }
  loadCategory('world-news').then(() => {
    ['tech','science','humanities','economics','investment'].forEach(c => loadCategory(c, true));
  });
}
function startup() {
  paintFromCache();
  tryStaticFeeds().then(state => {
    if (state === 'fresh') backgroundFillMissing();
    else if (state === 'stale') fullProxyFallback(true);
    else fullProxyFallback();
  });
}
startup();

// ─── NEWS CATEGORY FILTER ─────────────────────────────────────────────────────
function setNewsCat(nc) {
  S.newsCat = nc;
  document.querySelectorAll('.cat-chip').forEach(el =>
    el.classList.toggle('on', el.dataset.nc === nc));
  // Pull in the underlying categories on demand if they aren't loaded yet
  (NEWSCAT_CATS[nc] || []).forEach(c => { if (!S.fetchedCats.has(c)) loadCategory(c, true); });
  render();
}

// ─── SECTION SWITCHING ────────────────────────────────────────────────────────
function showSection(name) {
  M.currentSection = name;
  clearInterval(M.refreshTimer);
  ['feed-bar','news-cat-filter','articles','statusbar','footer'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('.section-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('sec-' + name);
  if (panel) panel.classList.add('active');
  document.querySelectorAll('.sb-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === name));
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
  if (name === 'portfolio') renderPortfolio();
  else if (name === 'watchlist') renderWatchlist();
  else if (name === 'screener') renderScreener();
  else if (name === 'sources') renderSources();
  if (name === 'portfolio' || name === 'watchlist') {
    M.refreshTimer = setInterval(() => {
      if (M.currentSection === 'portfolio') refreshPortfolioPrices();
      else if (M.currentSection === 'watchlist') refreshWatchlistPrices();
    }, 60000);
  }
}
function showNews() {
  M.currentSection = null;
  clearInterval(M.refreshTimer);
  ['feed-bar','news-cat-filter','articles','statusbar','footer'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });
  document.querySelectorAll('.section-panel').forEach(p => p.classList.remove('active'));
}
function toggleAddForm(id) {
  document.getElementById(id)?.classList.toggle('open');
}

// ─── SWIPE GESTURES ──────────────────────────────────────────────────────────
(function () {
  let sx = 0, sy = 0, swipeTarget = null;
  function onStart(e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
  function isSwipe(e) {
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    return Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 2 ? dx : 0;
  }
  // Article list: swipe right → open that article; swipe left → next article
  const artEl = document.getElementById('articles');
  artEl.addEventListener('touchstart', e => { onStart(e); swipeTarget = e.target.closest('.article'); }, { passive: true });
  artEl.addEventListener('touchend', e => {
    const dx = isSwipe(e);
    if (!dx) return;
    if (dx > 0 && swipeTarget?.dataset.id) openReader(swipeTarget.dataset.id);
    else if (dx < 0 && S.active) navArticle(1);
  }, { passive: true });
  // Reader: swipe left → close
  const rdrEl = document.getElementById('reader');
  rdrEl.addEventListener('touchstart', onStart, { passive: true });
  rdrEl.addEventListener('touchend', e => { if (isSwipe(e) < 0) closeReader(); }, { passive: true });
})();
// ─── PULL TO REFRESH ─────────────────────────────────────────────────────────
(function () {
  const el = document.getElementById('articles');
  let startY = 0, armed = false, past = false;
  const ind = document.createElement('div');
  ind.id = 'ptr-indicator';
  ind.textContent = '↻ release to refresh';
  el.addEventListener('touchstart', e => {
    armed = el.scrollTop === 0;
    past = false;
    if (armed) startY = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!armed) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 70 && !past) { past = true; el.prepend(ind); }
    else if (dy <= 70 && past) { past = false; ind.remove(); }
  }, { passive: true });
  el.addEventListener('touchend', () => {
    if (past) { ind.remove(); doRefresh(); }
    armed = past = false;
  }, { passive: true });
})();
// ─── DATA EXPORT / IMPORT ────────────────────────────────────────────────────
// Read state, saved articles, portfolio, watchlist, and alerts all live in
// localStorage — these let you move them between devices.
const _SYNC_KEYS = ['px_saved','px_read','px_portfolio','px_watchlist','px_alerts',
                    'px_port_history','px_theme','huozi-unread','huozi-compact'];
function exportData() {
  const out = { _app: 'huozi', _exported: new Date().toISOString() };
  for (const k of _SYNC_KEYS) {
    const v = localStorage.getItem(k);
    if (v != null) out[k] = v;
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `huozi-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (d._app !== 'huozi') { alert('Not a huozi backup file.'); return; }
      // Sets and ticker lists merge (union); object stores are overwritten.
      const union = (key) => {
        if (d[key] == null) return;
        const cur = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
        JSON.parse(d[key]).forEach(x => cur.add(x));
        localStorage.setItem(key, JSON.stringify([...cur]));
      };
      union('px_saved'); union('px_read'); union('px_watchlist');
      // Portfolio: merge by holding id so re-importing isn't destructive
      if (d.px_portfolio != null) {
        const cur = JSON.parse(localStorage.getItem('px_portfolio') || '[]');
        const ids = new Set(cur.map(h => h.id));
        JSON.parse(d.px_portfolio).forEach(h => { if (!ids.has(h.id)) cur.push(h); });
        localStorage.setItem('px_portfolio', JSON.stringify(cur));
      }
      ['px_alerts','px_port_history','px_theme','huozi-unread','huozi-compact'].forEach(k => {
        if (d[k] != null) localStorage.setItem(k, d[k]);
      });
      location.reload();
    } catch { alert('Could not read backup file.'); }
  };
  reader.readAsText(file);
}
document.getElementById('import-file')?.addEventListener('change', function () {
  if (this.files[0]) importData(this.files[0]);
  this.value = '';
});
// ─── SERVICE WORKER ──────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
// (startup cache paint handled by startup() above)
