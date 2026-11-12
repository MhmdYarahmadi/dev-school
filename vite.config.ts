import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { offline } from './offline/plugin';
import { pyodideFiles } from './offline/pyodide';

export default defineConfig({
  // offline(): writes dist/sw.js, which saves the site in the browser so the courses work offline.
  plugins: [react(), pyodideFiles(), offline(resolve(__dirname, 'offline/sw.js'))],
  // One site, several pages: / (course list), /pg/ (PostgreSQL), /docker/ (Docker), /design/ (System Design), /git/ (Git), /python/ (Python), /admin/ (dashboard).
  base: '/',
  build: {
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),
        pg: resolve(__dirname, 'pg/index.html'),
        docker: resolve(__dirname, 'docker/index.html'),
        design: resolve(__dirname, 'design/index.html'),
        git: resolve(__dirname, 'git/index.html'),
        python: resolve(__dirname, 'python/index.html'),
        admin: resolve(__dirname, 'admin/index.html'),
      },
    },
  },
  // In development, API calls go to the local backend (npm run server).
  server: { proxy: { '/api': process.env.API_TARGET ?? 'http://localhost:8787' } },
  // PGlite ships its own WASM + data bundle; pre-bundling breaks its asset URLs.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
