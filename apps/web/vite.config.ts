import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // One .env at the repo root serves the API, the database scripts and the app.
  const env = loadEnv(mode, '../..', '');
  return {
    envDir: '../..',
    worker: { format: 'es' },
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
