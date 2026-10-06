import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { connect, type Sql } from './db.js';

/** What the map needs to draw itself, and the file each one is written to. */
const FILES = {
  'offices.geojson': '/layers/offices.geojson',
  'events.geojson': '/layers/events.geojson',
  'stats.json': '/stats',
} as const;

/**
 * Writes the public map data as static files, so the map loads from a CDN and
 * does not depend on the API being up. The files are the API's own responses,
 * taken from the same routes, so the two cannot drift apart.
 */
export async function buildLayers(sql: Sql, outDir: string): Promise<Record<string, number>> {
  const app = await buildApp({ sql });
  const sizes: Record<string, number> = {};
  try {
    await mkdir(outDir, { recursive: true });
    const bodies: [string, string][] = [];
    for (const [file, path] of Object.entries(FILES)) {
      const response = await app.inject(path);
      // One failed query must not leave a half-updated set of files behind.
      if (response.statusCode !== 200) throw new Error(`${path} responded ${response.statusCode}`);
      bodies.push([file, response.body]);
    }
    const built = JSON.stringify({ built_at: new Date().toISOString() });
    for (const [file, body] of [...bodies, ['manifest.json', built] as [string, string]]) {
      // Written beside the target and renamed, so a reader never sees a partial file.
      const target = resolve(outDir, file);
      await writeFile(`${target}.tmp`, body);
      await rename(`${target}.tmp`, target);
      sizes[file] = Buffer.byteLength(body);
    }
  } finally {
    await app.close();
  }
  return sizes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir = resolve(
    process.argv[2] ?? process.env.LAYERS_OUT ?? fileURLToPath(new URL('../../web/public/data', import.meta.url)),
  );
  const sql = connect();
  try {
    const sizes = await buildLayers(sql, outDir);
    for (const [file, bytes] of Object.entries(sizes))
      console.log(`${(bytes / 1024).toFixed(1).padStart(8)} KB  ${file}`);
    console.log(`written to ${outDir}`);
  } finally {
    await sql.end();
  }
}
