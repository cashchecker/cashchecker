/* ═══════════ build-pages.mjs — assemble the Pages deploy folder ═══════════
   Cloudflare Pages uploads EVERY file in the directory you point it at, so
   deploying the project root would publish the worker source, wrangler config
   and helper scripts. This copies only what belongs on the public web into
   dist/, plus `_worker.js` (Pages' advanced mode) which serves the API and
   falls through to the static assets.

   It also stamps sw.js with a hash of everything it caches, so returning
   visitors never get served a previous build. See the stamp step below.
   ═══════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');

/** Only these are published. Anything not listed never reaches the web. */
const PUBLIC_FILES = ['index.html', 'manifest.webmanifest', 'sw.js'];
const PUBLIC_DIRS = ['css', 'js', 'assets'];

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}
const walk = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const rel = base ? `${base}/${e.name}` : e.name;
  return e.isDirectory() ? walk(path.join(dir, e.name), rel) : [rel];
});

rmrf(DIST);
fs.mkdirSync(DIST, { recursive: true });

let count = 0;
for (const f of PUBLIC_FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { console.error(`  missing required file: ${f}`); process.exit(1); }
  fs.copyFileSync(src, path.join(DIST, f));
  count++;
}
for (const d of PUBLIC_DIRS) {
  const src = path.join(ROOT, d);
  if (!fs.existsSync(src)) continue;
  copyDir(src, path.join(DIST, d));
}

// The API. Identical code to worker/index.js — it already ends with
// `env.ASSETS.fetch(req)`, which is exactly how Pages advanced mode works.
const worker = fs.readFileSync(path.join(ROOT, 'worker', 'index.js'), 'utf8');
fs.writeFileSync(path.join(DIST, '_worker.js'), worker, 'utf8');

/* Stamp the service worker.
   sw.js names its cache after VERSION and serves cached files first, so if
   VERSION does not change, a returning visitor keeps getting the PREVIOUS
   build's JavaScript no matter how many times they reload — a shipped fix
   simply never arrives. Deriving VERSION from a hash of the built files means
   any change at all produces a new cache name, and nobody has to remember to
   bump it by hand. Identical output ⇒ identical stamp ⇒ no needless refetch. */
const swPath = path.join(DIST, 'sw.js');
const hash = crypto.createHash('sha256');
for (const rel of walk(DIST).filter(f => f !== 'sw.js').sort()) {
  hash.update(rel);
  hash.update(fs.readFileSync(path.join(DIST, rel)));
}
const stamp = hash.digest('hex').slice(0, 12);
const swSrc = fs.readFileSync(swPath, 'utf8');
const swOut = swSrc.replace(/const VERSION = '[^']*';/, `const VERSION = 'b-${stamp}';`);
if (swOut === swSrc) {
  console.error("  could not stamp sw.js — expected a line like  const VERSION = '...';");
  process.exit(1);
}
fs.writeFileSync(swPath, swOut, 'utf8');

/* Sanity: nothing private must have crept in. */
const banned = [/wrangler.*\.toml$/i, /\.cmd$/i, /\.md$/i, /\.sql$/i, /^worker$/i, /^\.wrangler$/i, /^\.claude$/i];
const files = walk(DIST);
const leaked = files.filter(f => banned.some(re => re.test(path.basename(f)) || re.test(f.split('/')[0])));
if (leaked.length) {
  console.error('  private files would be published:', leaked.join(', '));
  process.exit(1);
}

const bytes = files.reduce((a, f) => a + fs.statSync(path.join(DIST, f)).size, 0);
console.log(`  dist/ built — ${files.length} files, ${(bytes / 1024).toFixed(0)} KB`);
console.log(`  API: _worker.js (${(worker.length / 1024).toFixed(1)} KB)`);
console.log(`  sw.js cache version: b-${stamp}`);
console.log(`  no private files included`);
