// Builds the SDK into single files any app can load with a <script> tag (window.AppsPlatform):
//   dist/apps-platform.js       full: realtime Firestore + Auth (sites, admin tools)
//   dist/apps-platform-lite.js  small: Firestore Lite + Auth, no realtime (mobile apps)
// and copies them into the sites that use them.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const common = { entryPoints: ['sdk/src/index.js'], bundle: true, format: 'iife', minify: true, target: 'es2019', legalComments: 'none', logLevel: 'warning' };
await build({ ...common, outfile: 'sdk/dist/apps-platform.js' });
await build({ ...common, outfile: 'sdk/dist/apps-platform-lite.js', alias: { 'firebase/firestore': require.resolve('firebase/firestore/lite') } });
mkdirSync('sites/sponsors/vendor', { recursive: true });
copyFileSync('sdk/dist/apps-platform.js', 'sites/sponsors/vendor/apps-platform.js');
for (const f of ['apps-platform.js', 'apps-platform-lite.js']) console.log(f, Math.round(statSync('sdk/dist/' + f).size / 1024) + ' KB');
