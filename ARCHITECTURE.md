# Apps platform — architecture

One Firebase project (`malka-apps`) serves every app. Each app is a *tenant* under `apps/{appId}`;
people (customers) and admins are shared, so one account works across all apps.

```
admins/{uid}                         { apps: ['*'] | ['omer', 'rhythm'], name }      ← created by hand in the console
users/{uid}                          { name, phone, email, created, apps: {omer: ts} } ← "registered customer"
apps/{appId}                         { name, ... }                                    ← app metadata (optional)
apps/{appId}/config/inventory        { users, opens, more, sellable, cpm, minPrice, allowCustom }
apps/{appId}/plans/{planId}          { name, desc, days, impressions, price, exclusive, active, order }
apps/{appId}/orders/{orderId}        { uid, planId, planName, purpose, name, from, season, start, days,
                                       impressions, alloc: {night: impressions}, price, exclusive,
                                       status: pending|active|paused|cancelled|done, created, sim? }
apps/{appId}/slots/{season}-{night}  { season, night, items: [{orderId, purpose, name, from, weight, exclusive}] }
apps/{appId}/stats/{season}-{night}-{shard}
                                     { season, night, shown:{orderId:n}, prayed:{}, more:{}, dwell:{},
                                       hours:{orderId:{hour:n}}, updated }
apps/{appId}/quotes/{id}             { text, source, order, active }
apps/{appId}/users/{uid}/...        private per-person app data (owner only, Google sign-in; admins have no access)
apps/reporting-hours/users/{uid}/kv/{key}  { v: JSON string, updated } ← one doc per local storage key
apps/{appId}/users/{uid}/grants/{email}     { email, role: view|report|full, ownerName, ownerEmail, created,
                                       granteeName?, seen? } ← owner shares their kv data with a Google account
apps/{appId}/shared/{email}/owners/{uid}    { email, role, ownerName, ownerEmail, created } ← same grant, listed by the grantee
```

## Flow of a dedication

1. **Order** — a signed-in, registered customer creates `orders/{id}` with `status: 'pending'`.
   The rules check the uid, the status and that the price equals the plan's price.
2. **Payment + approval** — the admin confirms payment in the site → `status: 'active'`.
   In the same batch the site rebuilds `slots/{season}-{night}` for every night of the order.
3. **Display** — the app reads ONE document per open: tonight's slot. It picks a dedication
   with probability ∝ `weight` (the impressions allotted to that night); an exclusive sponsor always comes first.
4. **Counters** — the app buffers shown / prayed / more / dwell on the device and writes them as one
   merge-write with `increment()` to its own shard (`SHARDS = 4`), at most every 15 s and when hidden.
5. **Reporting** — the site sums the shards per order (`sponsor.seasonCounts`).

## Why this shape

- **Cost**: one read + about one write per app open. At 5,000 users the season stays inside the free
  (Spark) quota; at 50,000 users it is a few dollars on Blaze.
- **No hot documents**: counters are sharded; slots are read-only for apps.
- **No server code needed yet**: everything runs on the free plan. Logic that must be trusted
  (payment webhooks, verified counters, capacity checks at order time) moves to Cloud Functions later.

## Known limits of v1 (by design, to fix when moving to Blaze)

- Stats are written by clients: the rules restrict the fields but cannot prove values only grow.
  → Cloud Function aggregation + App Check.
- Capacity is checked by the site and re-checked by the admin when approving; two customers can
  reserve the same last impressions at the same moment.
- Payment is manual (admin approves). → payment provider webhook into a Function.

## Adding another app

1. Pick an `appId` (e.g. `rhythm`). No console work: the collections appear on first write.
2. **Web / PWA / Capacitor**: copy `sdk/dist/apps-platform-lite.js` into the app and call
   `AppsPlatform.init({ appId, firebase: config })`. Use `P.db` for data under `P.path(...)`,
   `P.sponsor` for sponsorships, `P.auth` for sign-in.
3. **Native Android (Kotlin)**: add the Firebase BoM (`firebase-auth`, `firebase-firestore`) with the
   same project's `google-services.json`, and use the same paths (`apps/{appId}/...`).
4. Give admins access: `admins/{uid}.apps` → add the appId (or `'*'`).
5. Extend `firestore.rules` only if the app needs new collections under `apps/{appId}`.
