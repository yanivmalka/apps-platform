// Sponsorship (dedication) helpers shared by all apps.
// slots/<season>-<night>   { season, night, items: [{ orderId, purpose, name, from, weight, exclusive }] }
// stats/<season>-<night>-<shard>  { season, night, shown:{orderId:n}, prayed:{}, more:{}, dwell:{}, hours:{orderId:{h:n}} }
// Counters are buffered on the device and written as ONE merge-write per flush (cheap, no hot documents:
// each device writes to its own shard out of SHARDS).
export const SHARDS = 4;
const FIELDS = ['shown', 'prayed', 'more', 'dwell'];

export function createSponsor(P) {
  const ls = (() => { try { return localStorage; } catch (e) { return null; } })();
  let shard = 0;
  try { shard = +ls.getItem('ap-shard'); if (!(shard >= 0 && shard < SHARDS)) { shard = Math.floor(Math.random() * SHARDS); ls.setItem('ap-shard', shard); } } catch (e) { shard = Math.floor(Math.random() * SHARDS); }

  const key = (season, night) => `${season}-${night}`;
  let buf = {}; let timer = null; let flushing = Promise.resolve();

  const api = {
    SHARDS,
    async night(season, night) {
      const s = await P.db.get(P.path('slots', key(season, night)));
      return s ? (s.items || []) : [];
    },
    /** Sum of all shards for one night: { orderId: { shown, prayed, more, dwell } } */
    async counts(season, night) {
      const docs = await P.db.list(P.path('stats'), [['season', '==', season], ['night', '==', night]]);
      return sumStats(docs);
    },
    /** All counters of a season, per order (for the customer / admin views). */
    async seasonCounts(season) {
      return sumStats(await P.db.list(P.path('stats'), [['season', '==', season]]));
    },
    /** Weighted random pick among items not in `exclude` (exclusive sponsors always first). */
    pick(items, exclude = []) {
      const pool = items.filter(i => !exclude.includes(i.orderId));
      if (!pool.length) return null;
      const ex = pool.find(i => i.exclusive); if (ex) return ex;
      let r = Math.random() * pool.reduce((a, i) => a + (i.weight || 1), 0);
      for (const i of pool) { r -= (i.weight || 1); if (r <= 0) return i; }
      return pool[pool.length - 1];
    },
    track(season, night, field, orderId, n = 1) {
      if (!FIELDS.includes(field) || !orderId) return;
      const k = key(season, night); const b = buf[k] = buf[k] || { season, night, c: {}, hours: {} };
      b.c[field] = b.c[field] || {}; b.c[field][orderId] = (b.c[field][orderId] || 0) + n;
      if (field === 'prayed' && n > 0) { const h = String(new Date().getHours()); const m = b.hours[orderId] = b.hours[orderId] || {}; m[h] = (m[h] || 0) + n; }
      clearTimeout(timer); timer = setTimeout(() => api.flush(), 15000);
    },
    flush() {
      const pending = buf; buf = {}; clearTimeout(timer);
      if (!Object.keys(pending).length) return flushing;
      flushing = flushing.then(async () => {
        try {
          if (!P.auth.user) await P.auth.signInAnon();
          for (const b of Object.values(pending)) {
            const data = { season: b.season, night: b.night, updated: P.now() };
            for (const [f, m] of Object.entries(b.c)) { data[f] = {}; for (const [id, n] of Object.entries(m)) data[f][id] = P.inc(n); }
            if (Object.keys(b.hours).length) { data.hours = {}; for (const [id, m] of Object.entries(b.hours)) { data.hours[id] = {}; for (const [h, n] of Object.entries(m)) data.hours[id][h] = P.inc(n); } }
            await P.db.set(P.path('stats', `${key(b.season, b.night)}-${shard}`), data, { merge: true });
          }
        } catch (e) { // keep the counts for the next try
          for (const [k, b] of Object.entries(pending)) { const t = buf[k] = buf[k] || { season: b.season, night: b.night, c: {}, hours: {} };
            for (const [f, m] of Object.entries(b.c)) for (const [id, n] of Object.entries(m)) { t.c[f] = t.c[f] || {}; t.c[f][id] = (t.c[f][id] || 0) + n; } }
          console.warn('apps-platform: stats flush failed', e);
        }
      });
      return flushing;
    },
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.hidden) api.flush(); });
    window.addEventListener('pagehide', () => api.flush());
  }
  return api;
}

export function sumStats(docs) {
  const out = {};
  for (const d of docs) for (const f of FIELDS) for (const [id, n] of Object.entries(d[f] || {})) {
    const o = out[id] = out[id] || { shown: 0, prayed: 0, more: 0, dwell: 0 }; o[f] += n || 0;
  }
  return out;
}
