import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // One .env at the repo root serves the API, the database scripts and the app.
  const env = loadEnv(mode, '../..', '');
  // Names this build. Each page carries it, and `version.json` beside the pages says which build is live,
  // so a page left open or cached can tell it has been replaced (src/lib/freshness.ts).
  const buildId = mode === 'production' ? new Date().toISOString() : '';
  return {
    envDir: '../..',
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'build-version',
        apply: 'build',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: buildId }) });
        },
      },
    ],
    worker: { format: 'es' },
    build: {
      rollupOptions: {
        // Five pages: the landing page at the site root, then the map, the graph, the dashboard of tables,
        // and the review queue for reviewers.
        input: {
          landing: fileURLToPath(new URL('index.html', import.meta.url)),
          map: fileURLToPath(new URL('map/index.html', import.meta.url)),
          graph: fileURLToPath(new URL('graph/index.html', import.meta.url)),
          dashboard: fileURLToPath(new URL('dashboard/index.html', import.meta.url)),
          review: fileURLToPath(new URL('review/index.html', import.meta.url)),
        },
      },
    },
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://localhost:${env.API_PORT ?? 4000}`,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    test: { include: ['src/**/*.test.ts'] },
  };
});
