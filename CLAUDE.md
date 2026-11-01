# CLAUDE.md — apps-platform

Shared Firebase backend for all of the user's apps (omer-app first; Rhythme, wakecoach, fretquency… later).
Talk to the user in Hebrew. Read ARCHITECTURE.md before changing data paths or rules.

- `firestore.rules` is the only access control. Any change needs a matching test in `tests/rules.test.mjs`
  (runs in CI with the emulator; the emulator cannot be downloaded in Claude's cloud sandbox).
- `sdk/src` → `npm run build` → `sdk/dist/apps-platform(.lite).js`, copied into `sites/sponsors/vendor/`.
  Apps vendor the lite file (omer-app: `vendor/apps-platform-lite.js`) — re-copy it there after SDK changes.
- The SDK API is backend-neutral (`P.db.get/list/set/update/del/add/batch/watch/watchList`, `P.inc`, `P.now`,
  `P.sponsor`, `P.auth`). Apps never import Firebase directly.
- `?backend=memory` runs the site and apps against localStorage (same origin shares data) — use it for
  Playwright end-to-end tests: site order → admin approve → app shows dedication → stats back in admin.
- Slots are rebuilt by the admin site in the same batch as an order status change (`setOrders` in
  sites/sponsors/app.js). Keep that invariant if you add server code.
- Prices/plans decisions and the profit simulation came from the user's claude.ai artifact prototype.
