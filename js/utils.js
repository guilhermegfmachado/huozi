// ─── STRING / HTML HELPERS ───────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const stripHtml = s => { const d = document.createElement('div'); d.innerHTML = s; return (d.textContent||'').replace(/\s+/g,' ').trim(); };

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
  if (min < 60) return Math.max(1, Math.floor(min)) + 'm ago';
  if (hr  < 24) return Math.floor(hr) + 'h ago';
  const d0 = new Date(); d0.setHours(0,0,0,0);
  const d1 = new Date(date); d1.setHours(0,0,0,0);
  const dayDiff = Math.round((d0 - d1) / 86400000);
  if (dayDiff === 1) return 'yesterday';
  if (dayDiff <= 6) return dayDiff + 'd ago';
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

// ─── NUMBER FORMATTERS ────────────────────────────────────────────────────────
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
