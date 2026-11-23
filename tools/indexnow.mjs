// Tells IndexNow search engines (Bing, and through Bing ChatGPT search and Copilot; also
// Yandex, Seznam, Naver) about every page in the sitemap, so new and changed pages are
// crawled within hours instead of weeks. Run it after a deploy is live:
//     node tools/indexnow.mjs              (every URL in public/sitemap.xml)
//     node tools/indexnow.mjs /blog/x.html (just these paths)
// In Git Bash on Windows, a path starting with / is rewritten into a Windows path: pass full
// URLs there (https://sawari.airacode.online/blog/x.html) or run with MSYS_NO_PATHCONV=1.
// The key file public/<key>.txt proves the site is ours; the key is not a secret.
import { readFileSync } from 'node:fs';

const SITE = process.env.SITE_URL || 'https://sawari.airacode.online';
const KEY = '72e874f148160461d6898a27d6d01d78';
const args = process.argv.slice(2);
const urls = args.length
  ? args.map((p) => (p.startsWith('http') ? p : SITE + p))
  : [...readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urls }),
});
console.log(`IndexNow: ${urls.length} URLs -> HTTP ${res.status} ${res.status === 200 || res.status === 202 ? '(accepted)' : await res.text()}`);
