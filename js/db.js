// ─── INDEXED DB CACHE ─────────────────────────────────────────────────────────
const IDB = (() => {
  let _db = null;
  const open = () => new Promise((res, rej) => {
    if (_db) return res(_db);
    const r = indexedDB.open('huozi', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('articles', { keyPath: 'id' });
      r.result.createObjectStore('meta');
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror   = () => rej(r.error);
  });
  return {
    putAll: async articles => {
      const db = await open();
      const tx = db.transaction('articles', 'readwrite');
      const st = tx.objectStore('articles');
      articles.forEach(a => st.put({ ...a, _ts: Date.now() }));
      return new Promise(r => { tx.oncomplete = r; });
    },
    getRecent: async (maxMs = 7200000) => {
      const db = await open();
      return new Promise(res => {
        const r = db.transaction('articles').objectStore('articles').getAll();
        r.onsuccess = () => res(
          r.result.filter(a => Date.now() - a._ts < maxMs).map(({ _ts, ...a }) => a)
        );
      });
    },
  };
})();
