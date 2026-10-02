import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { SECURITY_HEADERS } from './security-headers';

const apiTarget = process.env.VITE_DEV_API_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Zod sans évaluation de code dans le navigateur (CSP sans 'unsafe-eval') : src/lib/zod.ts.
  resolve: {
    alias: [
      { find: /^zod$/, replacement: fileURLToPath(new URL('./src/lib/zod.ts', import.meta.url)) },
    ],
  },
  // Manifeste lu par scripts/check-bundle.mjs (budget du chargement initial).
  build: { manifest: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // En développement, l'API est servie derrière le même origine que l'interface
    // (même configuration qu'en production derrière Caddy) : pas de CORS à ouvrir.
    proxy: {
      '/api': apiTarget,
      '/health': apiTarget,
    },
  },
  // Build servi localement (parcours de bout en bout) avec les en-têtes de production.
  preview: { headers: SECURITY_HEADERS },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
