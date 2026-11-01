// In-browser test backend with the same API as the Firebase one.
// Data lives in localStorage, so pages on the same origin (the dedications site and an app under test)
// share it, and other tabs see changes through the 'storage' event. No security rules are enforced here.
// Sign-in: signInGoogle() signs in as ?as=<uid> from the page URL (default 'u-admin', who is an admin).
const KEY = 'apps-platform-mem', UKEY = 'apps-platform-mem-user';

export function createMemoryBackend(opts = {}) {
  const ls = (() => { try { const t = '__t'; localStorage.setItem(t, t); localStorage.removeItem(t); return localStorage; } catch (e) { return null; } })();
  let mem = {};
  const load = () => { try { mem = JSON.parse((ls && ls.getItem(KEY)) || '{}'); } catch (e) { mem = {}; } };
  const save = () => { try { ls && ls.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* quota */ } };
  load();
  if (!mem['admins/u-admin']) { mem['admins/u-admin'] = { apps: ['*'], name: 'מנהל בדיקה' }; save(); }

  const listeners = new Set();
  const notify = () => listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  if (typeof window !== 'undefined') window.addEventListener('storage', e => { if (e.key === KEY) { load(); notify(); } });

  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const segs = p => p.split('/').filter(Boolean);
  function apply(cur, data, merge) {
    const out = merge && cur && typeof cur === 'object' ? clone(cur) : {};
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && v.__ap === 'inc') out[k] = (typeof out[k] === 'number' ? out[k] : 0) + v.n;
      else if (v && typeof v === 'object' && v.__ap === 'now') out[k] = Date.now();
      else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = apply(merge ? out[k] : undefined, v, true);
      else out[k] = clone(v);
    }
    return out;
  }
  const test = (d, [f, op, v]) => {
    const x = d[f];
    switch (op) {
      case '==': return x === v; case '!=': return x !== v; case '<': return x < v; case '<=': return x <= v;
      case '>': return x > v; case '>=': return x >= v; case 'in': return v.includes(x);
      case 'array-contains': return Array.isArray(x) && x.includes(v); default: return false;
    }
  };
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const tick = () => new Promise(r => setTimeout(r, 0));

  const db = {
    async get(p) { await tick(); return clone(mem[p]) ?? null; },
    async list(p, where = [], order) {
      await tick();
      const n = segs(p).length, pre = p.replace(/\/$/, '') + '/';
      let out = Object.keys(mem).filter(k => k.startsWith(pre) && segs(k).length === n + 1)
        .map(k => ({ id: segs(k)[n], ...clone(mem[k]) })).filter(d => where.every(w => test(d, w)));
      if (order) out.sort((a, b) => (a[order[0]] > b[order[0]] ? 1 : -1) * (order[1] === 'desc' ? -1 : 1));
      else out.sort((a, b) => (a.id > b.id ? 1 : -1));
      return out;
    },
    async set(p, data, o = {}) { await tick(); mem[p] = apply(mem[p], data, !!o.merge); save(); notify(); },
    async update(p, data) { await tick(); if (!mem[p]) throw Object.assign(new Error('not-found ' + p), { code: 'not-found' }); mem[p] = apply(mem[p], data, true); save(); notify(); },
    async del(p) { await tick(); delete mem[p]; save(); notify(); },
    async add(p, data) { const id = rid(); await db.set(p + '/' + id, data); return id; },
    newId() { return rid(); },
    async batch(ops) {
      await tick();
      for (const o of ops) { if (o.op === 'delete') delete mem[o.path]; else mem[o.path] = apply(mem[o.path], o.data, o.op === 'update' || !!o.merge); }
      save(); notify();
    },
    watch(p, cb) { let last; const f = () => { const v = JSON.stringify(mem[p] ?? null); if (v !== last) { last = v; cb(clone(mem[p]) ?? null); } }; listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f); },
    watchList(p, where, cb, err, order) { let last; const f = async () => { const l = await db.list(p, where, order); const v = JSON.stringify(l); if (v !== last) { last = v; cb(l); } }; listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f); },
    _dump: () => clone(mem), _reset: () => { mem = {}; save(); notify(); },
  };

  const subs = new Set();
  let user = null; try { user = JSON.parse((ls && ls.getItem(UKEY)) || 'null'); } catch (e) { user = null; }
  const setUser = u => { user = u; try { ls && (u ? ls.setItem(UKEY, JSON.stringify(u)) : ls.removeItem(UKEY)); } catch (e) { /* ignore */ } authApi.user = u; subs.forEach(f => f(u)); };
  const authApi = {
    user,
    ready: () => Promise.resolve(),
    onChange(f) { subs.add(f); setTimeout(() => f(authApi.user), 0); return () => subs.delete(f); },
    async signInGoogle() {
      const as = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('as')) || 'u-admin';
      setUser({ uid: as, anonymous: false, name: as === 'u-admin' ? 'מנהל בדיקה' : 'לקוח ' + as, email: as + '@example.com', photo: '' });
    },
    async signInAnon() { if (!authApi.user) setUser({ uid: 'anon-' + rid(), anonymous: true, name: '', email: '', photo: '' }); return authApi.user; },
    async signOut() { setUser(null); },
  };
  return { kind: 'memory', db, auth: authApi };
}
