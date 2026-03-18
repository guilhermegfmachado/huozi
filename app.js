// ─── PROXY ───────────────────────────────────────────────────────────────────
const PROXY = url => `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`;
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
};
const saveSaved = () => localStorage.setItem('px_saved', JSON.stringify([...S.saved]));
const saveRead  = () => localStorage.setItem('px_read',  JSON.stringify([...S.read]));
// ─── UTILITY ─────────────────────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
// ─── DATE HELPERS ─────────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function relativeTime(date) {
  const ms = Date.now() - date.getTime();
  const min = ms / 60000;
  const hr  = ms / 3600000;
  if (min < 60) return Math.max(1, Math.floor(min)) + ' min ago';
  if (hr  < 24) return Math.floor(hr) + ' hr ago';
  const d0 = new Date(); d0.setHours(0,0,0,0);
  const d1 = new Date(date); d1.setHours(0,0,0,0);
  const dayDiff = Math.round((d0 - d1) / 86400000);
  if (dayDiff === 1) return 'yesterday';
  if (dayDiff <= 6) return dayDiff + ' days ago';
  const curYear = new Date().getFullYear();
  const label = date.getDate() + ' ' + MONTHS[date.getMonth()];
  return date.getFullYear() === curYear ? label : label + ' ' + date.getFullYear();
}
function formatAbsolute(date) {
  return date.toLocaleString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });
}
// ─── COUNTRY → TIMEZONE MAP ───────────────────────────────────────────────────
const CC_TZ = {
  US:'America/New_York', CA:'America/Toronto', BR:'America/Sao_Paulo',
  AR:'America/Argentina/Buenos_Aires', MX:'America/Mexico_City',
  GB:'Europe/London', FR:'Europe/Paris', DE:'Europe/Berlin',
  IT:'Europe/Rome', ES:'Europe/Madrid', PT:'Europe/Lisbon',
  CH:'Europe/Zurich', EU:'Europe/Brussels', PL:'Europe/Warsaw',
  JP:'Asia/Tokyo', CN:'Asia/Shanghai', HK:'Asia/Hong_Kong',
  KR:'Asia/Seoul', SG:'Asia/Singapore', IN:'Asia/Kolkata',
  TW:'Asia/Taipei', AU:'Australia/Sydney', NZ:'Pacific/Auckland',
  TH:'Asia/Bangkok', ID:'Asia/Jakarta', MY:'Asia/Kuala_Lumpur',
  PH:'Asia/Manila', VN:'Asia/Ho_Chi_Minh',
  ZA:'Africa/Johannesburg', NG:'Africa/Lagos', EG:'Africa/Cairo',
  SA:'Asia/Riyadh', QA:'Asia/Qatar', AE:'Asia/Dubai',
  IL:'Asia/Jerusalem', TR:'Europe/Istanbul', RU:'Europe/Moscow',
};
function tzLabel(cc) {
  const tz = CC_TZ[cc];
  if (!tz) return null;
  try {
    const abbr = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || tz;
    return abbr;
  } catch { return null; }
}
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
  const worldOrder = ['Europe','Americas','Asia-Pacific','MENA'];
  const vertOrder  = ['Analysis','Journalism','Institutional','Journals',
                      'Research','Preprints','Wire','Opinion','Blogs',
                      'Essays','Literature','History','Curated','Community'];
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
                  onclick="event.stopPropagation()">?</button>` : ''}
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
  const allRegions = {};
  for (const f of FEEDS) (allRegions[f.region] = allRegions[f.region] || []).push(f);
  const editorialOrder = ['wire', 'independent', 'state-funded'];
  body.innerHTML = Object.entries(allRegions).map(([region, feeds]) => `
    <div class="dir-region-head">${region}</div>
    ${feeds.map(f => {
      const editorial = (f.tags || []).find(t => editorialOrder.includes(t)) || '';
      const homepage = getHomepage(f.url);
      const tz = tzLabel(f.cc);
      return `<div class="dir-card" onclick="window.open('${homepage}','_blank','noopener')">
        <div class="dir-card-top">
          <span class="dir-flag">${f.flag}</span>
          <span class="dir-name">${f.name}</span>
          ${f.lang !== 'en' ? `<span class="dir-lang">${f.lang}</span>` : ''}
          ${editorial ? `<span class="dir-tag ${editorial}">${editorial}</span>` : ''}
          ${tz ? `<span class="dir-tz">${tz}</span>` : ''}
          <a class="dir-link" href="${homepage}" target="_blank" rel="noopener" onclick="event.stopPropagation()">↗</a>
        </div>
        ${f.notes ? `<span class="dir-notes">${f.notes}</span>` : ''}
      </div>`;
    }).join('')}
  `).join('');
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
// ─── FETCH ───────────────────────────────────────────────────────────────────
const stripHtml = s => { const d = document.createElement('div'); d.innerHTML = s; return (d.textContent||'').replace(/\s+/g,' ').trim(); };
async function fetchOne(f) {
  try {
    const r = await fetch(PROXY(f.url));
    if (!r.ok) throw 0;
    const d = await r.json();
    if (d.status !== 'ok') throw 0;
    return (d.items||[]).map(i => ({
      id:      i.guid||i.link||Math.random().toString(36),
      feedId:  f.id,
      cat:     f.cat,
      name:    f.name,
      flag:    f.flag,
      cc:      f.cc || '--',
      lang:    f.lang,
      title:   i.title||'',
      desc:    i.description ? stripHtml(i.description).slice(0,400) : '',
      link:    i.link||'',
      date:    (() => { const d = parseDate(i.pubDate); return d ? d.getTime() : Date.now(); })(),
      readMin: Math.max(1, Math.round((i.description ? stripHtml(i.description).split(/\s+/).length : 50) / 200)),
    }));
  } catch { return []; }
}
// Priority feeds loaded first for fast initial render
const PRIORITY = new Set(['bbc','guardian','nyt','ap','aljazeera','dw','ft','nhk']);
async function fetchBatch(feeds, trackProgress = false) {
  const promises = feeds.map(f =>
    fetchOne(f).then(items => {
      if (trackProgress) {
        loadProgress.done++;
        updateLoadingText();
      }
      S.counts[f.id] = items.length;
      const el = document.getElementById('c-' + f.id);
      if (el) el.textContent = items.length || '·';
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
  document.getElementById('c-all').textContent = S.articles.length;
  document.getElementById('updated').textContent = 'updated just now';
  updateStats(); render();
}
async function loadCategory(cat, silent = false) {
  if (S.fetchedCats.has(cat) && cat !== 'all') return;
  S.fetchedCats.add(cat);
  const feeds = cat === 'all' ? FEEDS : FEEDS.filter(f => f.cat === cat);
  if (!silent) {
    loadProgress.done = 0;
    loadProgress.total = feeds.length;
    document.getElementById('articles').innerHTML =
      `<div class="state-row"><div class="spinner"></div> fetching feeds… 0 / ${feeds.length}</div>`;
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
  loadCategory('world-news');
}
// ─── RENDER ───────────────────────────────────────────────────────────────────
const CATS = new Set(['world-news','tech','science','humanities','economics','investment']);
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
  // News category filter
  if (S.newsCat && S.newsCat !== 'all') {
    const ASIA_CC = new Set(['JP','KR','CN','HK','SG','IN','TW','MY','TH','ID','PH','VN','AU','NZ']);
    if (S.newsCat === 'general')    a = a.filter(x => x.cat !== 'investment');
    else if (S.newsCat === 'investment') a = a.filter(x => x.cat === 'investment');
    else if (S.newsCat === 'asia')  a = a.filter(x => ASIA_CC.has(x.cc) || x.region === 'Asia-Pacific' || x.region === 'Asia');
    else if (S.newsCat === 'china') a = a.filter(x => x.cc === 'CN' || x.cc === 'HK' || x.region === 'China');
  }
  if (S.unread) a = a.filter(x => !S.read.has(x.id));
  if (S.query) { const q=S.query.toLowerCase(); a = a.filter(x => x.title.toLowerCase().includes(q)||x.desc.toLowerCase().includes(q)); }
  if (S.sort === 'source') {
    a = [...a].sort((x,y) => x.name.localeCompare(y.name));
  } else if (S.sort === 'recent') {
    a = [...a].sort((x,y) => y.date - x.date);
  } else {
    a = interleave([...a]);
  }
  return a;
}
// ─── FEED ORDERING ────────────────────────────────────────────────────────────
function decayScore(article) {
  const hoursOld = (Date.now() - article.date) / 3_600_000;
  return 1 / Math.pow(hoursOld + 2, 1.4);
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
function render() {
  const list = visible();
  const wrap = document.getElementById('articles');
  wrap.className = S.compact ? 'compact' : '';
  if (!list.length) { wrap.innerHTML = '<div id="empty">no articles</div>'; return; }
  wrap.innerHTML = list.map(a => {
    const isSaved = S.saved.has(a.id);
    const langBadge = a.lang !== 'en'
      ? `<span class="a-lang">${a.lang}</span>` : '';
    const xlateAction = a.lang !== 'en'
      ? `<button class="a-action-btn" onclick="event.stopPropagation();inlineXlate(this,'${esc(a.title)}','${a.lang}')">⟳ translate</button>` : '';
    return `<div class="article${S.read.has(a.id)?' read':''}${S.active===a.id?' active':''}"
                 data-id="${esc(a.id)}"
                 onclick="openReader('${esc(a.id)}')">
      <div class="a-meta">
        <span class="a-cc">${esc(a.cc||'--')}</span>
        <span class="a-src">${esc(a.name)}</span>
        ${langBadge}
        <span class="a-dot">·</span>
        <span class="a-time" data-ts="${a.date}" title="${formatAbsolute(new Date(a.date))}">${relativeTime(new Date(a.date))}</span>
        <span class="a-dot">·</span>
        <span class="a-read-time">${a.readMin||1}m</span>
      </div>
      <div class="a-title">${esc(a.title)}</div>
      <div class="a-desc">${esc(a.desc)}</div>
      <div class="a-actions">
        <button class="a-action-btn${isSaved?' saved':''}"
          onclick="event.stopPropagation();toggleSave('${esc(a.id)}')">${isSaved?'◆ saved':'◇ save'}</button>
        <span class="a-dot">·</span>
        <a class="a-open-link" href="${esc(a.link)}" target="_blank" rel="noopener"
          onclick="event.stopPropagation()">↗ open</a>
        ${xlateAction ? `<span class="a-dot">·</span>${xlateAction}` : ''}
      </div>
    </div>`;
  }).join('');
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
function toggleUnread()  { S.unread=!S.unread;  localStorage.setItem('huozi-unread',S.unread);  document.getElementById('btn-unread').classList.toggle('on',S.unread);  render(); }
function toggleCompact() { S.compact=!S.compact; localStorage.setItem('huozi-compact',S.compact); document.getElementById('btn-compact').classList.toggle('on',S.compact); render(); }
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
    `<div class="saved-dd-item" onclick="event.stopPropagation();openReader('${esc(a.id)}');document.getElementById('saved-dropdown').style.display='none'">${esc(a.title)}</div>`
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
});
function toggleSave(id) {
  if (S.saved.has(id)) { S.saved.delete(id); } else { S.saved.add(id); }
  saveSaved();
  document.getElementById('c-saved').textContent = S.saved.size;
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
  document.getElementById('r-date').textContent  = new Date(a.date).toLocaleString();
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
  document.getElementById('mob-toggle').textContent = open ? '✕' : '☰';
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
  const saved = localStorage.getItem('px_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('btn-theme').textContent = saved === 'dark' ? '☀' : '◑';
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('px_theme', next);
  document.getElementById('btn-theme').textContent = next === 'dark' ? '☀' : '◑';
}
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
initTheme();
buildSidebar();
document.getElementById('feed-name').textContent = '';
document.getElementById('btn-unread').classList.toggle('on', S.unread);
document.getElementById('btn-compact').classList.toggle('on', S.compact);
loadCategory('world-news');

// ─── NEWS CATEGORY FILTER ─────────────────────────────────────────────────────
function setNewsCat(nc) {
  S.newsCat = nc;
  document.querySelectorAll('.cat-chip').forEach(el =>
    el.classList.toggle('on', el.dataset.nc === nc));
  render();
}

// ─── SECTION SWITCHING ────────────────────────────────────────────────────────
const M = {
  portfolio: JSON.parse(localStorage.getItem('px_portfolio') || '[]'),
  watchlist: JSON.parse(localStorage.getItem('px_watchlist') || '[]'),
  alerts:    JSON.parse(localStorage.getItem('px_alerts')    || '[]'),
  portSort: { col: 'ticker', dir: 1 },
  prices: {},
  refreshTimer: null,
  currentSection: null,
};
const savePortfolio = () => localStorage.setItem('px_portfolio', JSON.stringify(M.portfolio));
const saveWatchlist = () => localStorage.setItem('px_watchlist', JSON.stringify(M.watchlist));
const saveAlerts    = () => localStorage.setItem('px_alerts',    JSON.stringify(M.alerts));

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

// ─── PRICE FETCHING ───────────────────────────────────────────────────────────
const priceCache = {};
async function fetchPrice(ticker) {
  const key = ticker.toUpperCase();
  const cached = priceCache[key];
  if (cached && Date.now() - cached.ts < 300000) return cached.data;
  const urls = [
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?interval=1d&range=2d`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?interval=1d&range=2d`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const d = await r.json();
      const result = d.chart?.result?.[0];
      if (!result) continue;
      const meta = result.meta;
      const price = meta.regularMarketPrice ?? meta.previousClose ?? null;
      const prev  = meta.chartPreviousClose ?? meta.previousClose ?? price;
      const data  = {
        price, prevClose: prev,
        change: price != null && prev != null ? price - prev : null,
        changePct: price != null && prev ? ((price - prev) / prev) * 100 : null,
        high52: meta.fiftyTwoWeekHigh ?? null,
        low52:  meta.fiftyTwoWeekLow  ?? null,
        currency: meta.currency || 'USD',
        name: meta.longName || meta.shortName || key,
      };
      priceCache[key] = { ts: Date.now(), data };
      return data;
    } catch { /* try next */ }
  }
  return null;
}
async function fetchFundamentals(ticker) {
  const key = ticker.toUpperCase();
  const ckey = key + '_fund';
  const cached = priceCache[ckey];
  if (cached && Date.now() - cached.ts < 300000) return cached.data;
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(key)}?modules=price,summaryDetail`;
    const r = await fetch(url);
    if (!r.ok) throw 0;
    const d = await r.json();
    const res = d.quoteSummary?.result?.[0];
    if (!res) throw 0;
    const p = res.price || {}, s = res.summaryDetail || {};
    const data = {
      name: p.longName || p.shortName || key,
      price: p.regularMarketPrice?.raw ?? null,
      changePct: p.regularMarketChangePercent?.raw != null ? p.regularMarketChangePercent.raw * 100 : null,
      marketCap: p.marketCap?.raw ?? null,
      pe: s.trailingPE?.raw ?? null,
      currency: p.currency || 'USD',
    };
    priceCache[ckey] = { ts: Date.now(), data };
    return data;
  } catch { return null; }
}

// ─── FORMATTING HELPERS ───────────────────────────────────────────────────────
const fmt    = (n, d=2) => n == null ? '—' : n.toLocaleString('en-US', {minimumFractionDigits:d, maximumFractionDigits:d});
const fmtSgn = (n, sym='') => n == null ? '—' : (n < 0 ? '-' : '+') + sym + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
const fmtPct = n => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const fmtCap = n => {
  if (n == null) return '—';
  if (n >= 1e12) return '$' + (n/1e12).toFixed(1) + 'T';
  if (n >= 1e9)  return '$' + (n/1e9).toFixed(1)  + 'B';
  if (n >= 1e6)  return '$' + (n/1e6).toFixed(1)  + 'M';
  return '$' + n.toLocaleString();
};
const gainCls = n => n == null ? '' : n > 0 ? 'p-gain' : n < 0 ? 'p-loss' : 'p-flat';
const uuid    = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ─── PORTFOLIO ────────────────────────────────────────────────────────────────
async function renderPortfolio() {
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
  const priceMap = {};
  await Promise.all(tickers.map(async t => { priceMap[t] = await fetchPrice(t); }));
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
    const p     = priceMap[h.ticker];
    const price = p?.price ?? null;
    const value = price != null ? price * h.shares : null;
    const cost  = h.avgCost * h.shares;
    const gl    = value != null ? value - cost : null;
    const glPct = value != null && cost ? ((value - cost) / cost) * 100 : null;
    if (value != null) totalValue += value;
    totalCost += cost;
    return { ...h, price, value, cost, gl, glPct };
  });
  // Sort
  const { col, dir } = M.portSort;
  rows.sort((a, b) => {
    const av = a[col] ?? (dir > 0 ? Infinity : -Infinity);
    const bv = b[col] ?? (dir > 0 ? Infinity : -Infinity);
    return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * dir;
  });
  const totalGL    = totalValue - totalCost;
  const totalGLPct = totalCost ? (totalGL / totalCost) * 100 : 0;
  summary.innerHTML = `
    <div class="port-card"><div class="port-card-label">total value</div>
      <div class="port-card-value">${totalValue ? fmt(totalValue) : '—'}</div></div>
    <div class="port-card"><div class="port-card-label">total cost</div>
      <div class="port-card-value">${fmt(totalCost)}</div></div>
    <div class="port-card"><div class="port-card-label">gain / loss</div>
      <div class="port-card-value ${gainCls(totalGL)}">${fmtSgn(totalGL)}</div>
      <div class="port-card-sub ${gainCls(totalGLPct)}">${fmtPct(totalGLPct)}</div></div>
    <div class="port-card"><div class="port-card-label">holdings</div>
      <div class="port-card-value">${M.portfolio.length}</div></div>`;
  // Allocation bars
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
    <td class="col-num">${r.price != null ? fmt(r.price) : '—'}</td>
    <td class="col-num">${r.value != null ? fmt(r.value) : '—'}</td>
    <td class="col-num ${gainCls(r.gl)}">${r.gl != null ? fmtSgn(r.gl) : '—'}</td>
    <td class="col-num ${gainCls(r.glPct)}">${fmtPct(r.glPct)}</td>
    <td class="col-act">
      <button class="tbl-act-btn add-btn" onclick="addTickerToWatchlist('${r.ticker}')" title="add to watchlist">◉</button>
      <button class="tbl-act-btn" onclick="deleteHolding('${r.id}')" title="remove">✕</button>
    </td></tr>`).join('');
  document.getElementById('port-info').textContent =
    `${M.portfolio.length} holdings · ${totalValue ? fmt(totalValue) : '—'}`;
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
async function renderWatchlist() {
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
  await Promise.all(M.watchlist.map(async t => {
    const p = await fetchPrice(t);
    _updateWLRow(t, p);
    _checkAlerts(t, p);
  }));
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
  const results = await Promise.all(tickers.map(async t => {
    const d = await fetchFundamentals(t);
    return { ticker: t, ...(d || {}) };
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
