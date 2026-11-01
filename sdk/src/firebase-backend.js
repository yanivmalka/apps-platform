// Firebase implementation of the platform backend.
// The "lite" build aliases 'firebase/firestore' to 'firebase/firestore/lite' (smaller, no realtime):
// watch/watchList then fall back to polling.
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, signInWithRedirect,
  GoogleAuthProvider, signOut, browserLocalPersistence, setPersistence,
} from 'firebase/auth';
import * as FS from 'firebase/firestore';

const OPS = { '==': '==', '!=': '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=', in: 'in', 'array-contains': 'array-contains' };

function toFs(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (v.__ap === 'inc') return FS.increment(v.n);
    if (v.__ap === 'now') return FS.serverTimestamp();
    const o = {}; for (const [k, x] of Object.entries(v)) o[k] = toFs(x); return o;
  }
  if (Array.isArray(v)) return v.map(toFs);
  return v;
}
function fromFs(v) {
  if (v && typeof v === 'object') {
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (Array.isArray(v)) return v.map(fromFs);
    const o = {}; for (const [k, x] of Object.entries(v)) o[k] = fromFs(x); return o;
  }
  return v;
}

export async function createFirebaseBackend(opts) {
  const app = getApps()[0] || initializeApp(opts.firebase);
  const auth = getAuth(app);
  try { await setPersistence(auth, browserLocalPersistence); } catch (e) { /* storage blocked: session only */ }
  const fdb = FS.getFirestore(app);
  const realtime = typeof FS.onSnapshot === 'function';
  const ref = p => FS.doc(fdb, p);
  const col = p => FS.collection(fdb, p);
  const q = (p, where = [], order) => {
    const parts = where.map(([f, op, v]) => FS.where(f, OPS[op] || op, v));
    if (order) parts.push(FS.orderBy(order[0], order[1] || 'asc'));
    return parts.length ? FS.query(col(p), ...parts) : col(p);
  };
  const docs = snap => snap.docs.map(d => ({ id: d.id, ...fromFs(d.data()) }));
  const poll = (fn, cb, ms) => { let stop = false; const tick = async () => { if (stop) return; try { cb(await fn()); } catch (e) { /* retry next tick */ } if (!stop) setTimeout(tick, ms); }; tick(); return () => { stop = true; }; };

  const db = {
    async get(p) { const s = await FS.getDoc(ref(p)); return s.exists() ? fromFs(s.data()) : null; },
    async list(p, where, order) { return docs(await FS.getDocs(q(p, where, order))); },
    set(p, data, o = {}) { return FS.setDoc(ref(p), toFs(data), o.merge ? { merge: true } : {}); },
    update(p, data) { return FS.updateDoc(ref(p), toFs(data)); },
    del(p) { return FS.deleteDoc(ref(p)); },
    async add(p, data) { const r = FS.doc(col(p)); await FS.setDoc(r, toFs(data)); return r.id; },
    newId(p) { return FS.doc(col(p)).id; },
    async batch(ops) { // chunks of 450 writes
      for (let i = 0; i < ops.length; i += 450) {
        const b = FS.writeBatch(fdb);
        for (const o of ops.slice(i, i + 450)) {
          if (o.op === 'delete') b.delete(ref(o.path));
          else if (o.op === 'update') b.update(ref(o.path), toFs(o.data));
          else b.set(ref(o.path), toFs(o.data), o.merge ? { merge: true } : {});
        }
        await b.commit();
      }
    },
    watch(p, cb, err) {
      if (!realtime) return poll(() => db.get(p), cb, 60000);
      return FS.onSnapshot(ref(p), s => cb(s.exists() ? fromFs(s.data()) : null), e => err && err(e));
    },
    watchList(p, where, cb, err, order) {
      if (!realtime) return poll(() => db.list(p, where, order), cb, 60000);
      return FS.onSnapshot(q(p, where, order), s => cb(docs(s)), e => err && err(e));
    },
  };

  const userOf = u => u && ({ uid: u.uid, anonymous: u.isAnonymous, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' });
  let ready; const first = new Promise(r => { ready = r; });
  const subs = new Set();
  onAuthStateChanged(auth, u => { authApi.user = userOf(u); ready(); subs.forEach(f => f(authApi.user)); });
  const authApi = {
    user: null,
    ready: () => first,
    onChange(f) { subs.add(f); first.then(() => f(authApi.user)); return () => subs.delete(f); },
    async signInGoogle() {
      const pr = new GoogleAuthProvider();
      try { await signInWithPopup(auth, pr); } catch (e) {
        if (e && /popup-blocked|operation-not-supported/.test(e.code || '')) await signInWithRedirect(auth, pr); else throw e;
      }
    },
    async signInAnon() { await first; if (!auth.currentUser) await signInAnonymously(auth); return authApi.user; },
    signOut: () => signOut(auth),
  };
  return { kind: realtime ? 'firebase' : 'firebase-lite', db, auth: authApi };
}
