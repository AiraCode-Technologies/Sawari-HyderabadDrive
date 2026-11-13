import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The version shown in the website footer: package.json's version (bumped with every
// push) and the commit it was built from, so every deploy shows a new number.
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));
let commit = process.env.VERCEL_GIT_COMMIT_SHA || '';
if (!commit) {
  try {
    commit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    commit = '';
  }
}
const VERSION = `${pkg.version}${commit ? ` · ${commit.slice(0, 7)}` : ''}`;
const version = { name: 'sawari-version', transformIndexHtml: (html) => html.replaceAll('%SAWARI_VERSION%', VERSION) };

// Multi-page site: the website pages in English (root) and in Hindi, Urdu and
// Telugu (/hi/, /ur/, /te/), a 404 page, plus the game itself (play.html).
const pages = ['index', 'routes', 'features', 'about'];
const input = { play: resolve(__dirname, 'play.html'), notFound: resolve(__dirname, '404.html') };
for (const lang of ['', 'hi', 'ur', 'te'])
  for (const p of pages) input[`${lang || 'en'}-${p}`] = resolve(__dirname, lang, `${p}.html`);

export default defineConfig({
  plugins: [version],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: { input },
  },
});
