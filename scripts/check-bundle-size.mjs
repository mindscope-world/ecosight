// Fails when the JavaScript the browser must load before a page shows exceeds
// the budget. For each page it counts the entry script and its preloaded chunks,
// gzip-compressed; lazily loaded chunks (the landing page's maps, the 3D globe)
// are not on this path.
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 600;
const PAGES = { 'Landing page': 'index.html', 'Map app': 'map/index.html' };
const dist = new URL('../apps/web/dist/', import.meta.url);

let over = false;
for (const [name, page] of Object.entries(PAGES)) {
  const html = await readFile(new URL(page, dist), 'utf8');
  const files = new Set();
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
    const isScript = tag.startsWith('<script') && /type="module"/.test(tag);
    const isPreload = tag.startsWith('<link') && /rel="modulepreload"/.test(tag);
    const path = /(?:src|href)="([^"]+\.js)"/.exec(tag)?.[1];
    if ((isScript || isPreload) && path) files.add(path.replace(/^\//, ''));
  }
  if (!files.size) throw new Error(`No entry scripts found in dist/${page}`);

  let total = 0;
  for (const file of files) total += gzipSync(await readFile(new URL(file, dist))).length;
  const kb = total / 1024;
  console.log(`${kb.toFixed(1).padStart(8)} KB  ${name}: first-load JavaScript (budget ${BUDGET_KB} KB)`);
  if (kb > BUDGET_KB) over = true;
}
if (over) {
  console.error('First-load JavaScript is over budget.');
  process.exit(1);
}
