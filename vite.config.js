import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Multi-page site: the website pages in English (root) and in Hindi, Urdu and
// Telugu (/hi/, /ur/, /te/), a 404 page, plus the game itself (play.html).
const pages = ['index', 'routes', 'features', 'about'];
const input = { play: resolve(__dirname, 'play.html'), notFound: resolve(__dirname, '404.html') };
for (const lang of ['', 'hi', 'ur', 'te'])
  for (const p of pages) input[`${lang || 'en'}-${p}`] = resolve(__dirname, lang, `${p}.html`);

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: { input },
  },
});
