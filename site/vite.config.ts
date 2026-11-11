import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { forBuild } from './counter.js';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

// The ID of the website for the page counter. Only the deployment of the project's own site gives it to the build
// (see docs/releasing.md); without it the pages count nothing, and say so.
const COUNTER_ID = process.env.ANALYTICS_WEBSITE_ID || undefined;

/**
 * What the built pages may load and run. The policy is a meta tag, so that it travels with the pages to any host;
 * `public/_headers` adds what a meta tag cannot say. It is put in by the build only, because the development server
 * works with inline scripts.
 */
const POLICY = [
  "default-src 'self'",
  // Only the page's own files run as script: nothing inline, nothing from elsewhere. WebAssembly is what the language
  // models are made of. 'unsafe-eval' is there for one reason: the library that writes the XML compiles its checks
  // of the invoice data from text when it is first used. It can go when that library ships them compiled.
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  // Open on purpose: a model is downloaded from huggingface.co, which hands the files out through other hosts, and
  // from raw.githubusercontent.com, and the user may name any address for a model endpoint of their own.
  'connect-src *',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

// The site is static: no server sees an invoice. It is built from src/, so the page runs the same code as the package.
export default defineConfig({
  plugins: [
    {
      name: 'page-counter',
      transformIndexHtml: {
        order: 'pre',
        handler: (html: string) => forBuild(html, Boolean(COUNTER_ID)),
      },
    },
    {
      name: 'content-security-policy',
      apply: 'build',
      transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: POLICY }, injectTo: 'head-prepend' }],
    },
  ],
  root: page('.'),
  base: './',
  // What count.ts counts for; empty in a build that does not count, which leaves its code out.
  define: { COUNTER_WEBSITE_ID: JSON.stringify(COUNTER_ID ?? '') },
  // Several pages, no router: the local server answers an address that does not exist with 404, as the host does,
  // instead of with the start page. A request for a file the site does not ship then shows up while testing.
  appType: 'mpa',
  // The package's default entry is its Node build, which pulls in modules a browser does not have. Its browser
  // bundle is the one the upstream README points browsers to.
  resolve: { alias: { '@e-invoice-eu/core': page('../node_modules/@e-invoice-eu/core/dist/e-invoice-eu.min.js') } },
  server: { port: 4350, host: '127.0.0.1', fs: { allow: [page('..')] } },
  build: {
    outDir: '../site-dist',
    emptyOutDir: true,
    target: 'es2022',
    // Every font is a file of its own: a small one written into the style sheet would need the policy to allow fonts from data.
    assetsInlineLimit: 0,
    rolldownOptions: { input: ['index.html', 'legal-notice.html', 'privacy.html'].map(page) },
  },
  worker: { format: 'es' },
});
