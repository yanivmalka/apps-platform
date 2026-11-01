// apps-platform SDK: one entry point for every app and site that talks to the shared Firebase project.
// Exposes a small, backend-neutral API so apps never import Firebase directly:
//   const P = await AppsPlatform.init({ appId: 'omer', firebase: firebaseConfig })      // real backend
//   const P = await AppsPlatform.init({ appId: 'omer', backend: 'memory' })            // local test backend
//   P.auth  — user, onChange, signInGoogle, signInAnon, signOut
//   P.db    — get, list, set, update, del, add, batch, watch, watchList (paths are plain strings)
//   P.inc(n), P.now()  — write sentinels (atomic increment, server time)
//   P.sponsor — dedication / sponsorship helpers used by the apps (slot of a night, counters)
import { createMemoryBackend } from './memory-backend.js';
import { createSponsor } from './sponsor.js';

export const VERSION = '1.0.0';
export const inc = n => ({ __ap: 'inc', n });
export const now = () => ({ __ap: 'now' });

export async function init(opts = {}) {
  const appId = opts.appId || 'default';
  let backend;
  if (opts.backend === 'memory' || !opts.firebase || !opts.firebase.apiKey) {
    if (opts.backend !== 'memory') return null; // not configured: callers hide cloud features
    backend = createMemoryBackend(opts);
  } else {
    const { createFirebaseBackend } = await import('./firebase-backend.js');
    backend = await createFirebaseBackend(opts);
  }
  const P = {
    appId, kind: backend.kind, auth: backend.auth, db: backend.db, inc, now,
    path: (...seg) => ['apps', appId, ...seg].join('/'),
  };
  P.sponsor = createSponsor(P);
  return P;
}

const api = { init, inc, now, VERSION };
if (typeof window !== 'undefined') window.AppsPlatform = api;
export default api;
