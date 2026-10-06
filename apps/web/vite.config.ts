import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // One .env at the repo root serves the API, the database scripts and the app.
  const env = loadEnv(mode, '../..', '');
  return {
    envDir: '../..',
    plugins: [react(), tailwindcss()],
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
