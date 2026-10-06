// Fails when the JavaScript the browser must load before the map shows exceeds
// the budget. Counts the entry script and its preloaded chunks, gzip-compressed;
// lazily loaded chunks (the 3D globe, account screens) are not on this path.
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 600;
const dist = new URL('../apps/web/dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');

const files = new Set();
for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
  const isScript = tag.startsWith('<script') && /type="module"/.test(tag);
  const isPreload = tag.startsWith('<link') && /rel="modulepreload"/.test(tag);
  const path = /(?:src|href)="([^"]+\.js)"/.exec(tag)?.[1];
  if ((isScript || isPreload) && path) files.add(path.replace(/^\//, ''));
}
if (!files.size) throw new Error('No entry scripts found in dist/index.html');

let total = 0;
for (const file of files) {
  const size = gzipSync(await readFile(new URL(file, dist))).length;
  total += size;
  console.log(`${(size / 1024).toFixed(1).padStart(8)} KB  ${file}`);
}
const kb = total / 1024;
console.log(`${kb.toFixed(1).padStart(8)} KB  first-load JavaScript (budget ${BUDGET_KB} KB)`);
if (kb > BUDGET_KB) {
  console.error('First-load JavaScript is over budget.');
  process.exit(1);
}
