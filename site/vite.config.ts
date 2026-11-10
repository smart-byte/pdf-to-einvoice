import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

// The site is static: no server sees an invoice. It is built from src/, so the page runs the same code as the package.
export default defineConfig({
  root: page('.'),
  base: './',
  // The package's default entry is its Node build, which pulls in modules a browser does not have. Its browser
  // bundle is the one the upstream README points browsers to.
  resolve: { alias: { '@e-invoice-eu/core': page('../node_modules/@e-invoice-eu/core/dist/e-invoice-eu.min.js') } },
  server: { port: 4350, host: '127.0.0.1', fs: { allow: [page('..')] } },
  build: { outDir: '../site-dist', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' },
});
