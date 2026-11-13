// Website pages: light/dark theme toggle, mobile menu, language menu, footer year.
// (The theme itself is applied by a tiny inline script in each page's <head>,
// before the page paints, so there is no flash of the wrong theme.)
// Every language is its own static page (/, /hi/, /ur/, /te/), so search engines
// can index each one; the language menu simply links between them.
const KEY = 'hyd-site-theme';
const LKEY = 'sawari-lang';
const root = document.documentElement;
const media = matchMedia('(prefers-color-scheme: dark)');

function stored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}

// ---------- theme ----------
const themeBtn = document.querySelector('.theme-btn');
function apply(theme) {
  root.dataset.theme = theme;
  if (themeBtn) {
    // labels come from the page, already in its language
    themeBtn.setAttribute('aria-label', theme === 'dark' ? themeBtn.dataset.labelLight : themeBtn.dataset.labelDark);
    themeBtn.setAttribute('aria-pressed', String(theme === 'dark'));
  }
}
apply(stored(KEY) || (media.matches ? 'dark' : 'light'));
// follow the system setting until the visitor picks a theme themselves
media.addEventListener('change', (e) => {
  if (!stored(KEY)) apply(e.matches ? 'dark' : 'light');
});
themeBtn?.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  apply(next);
  store(KEY, next);
});

// ---------- mobile menu ----------
const menuBtn = document.querySelector('.menu-btn'), nav = document.querySelector('.nav');
menuBtn?.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', String(open));
});

for (const el of document.querySelectorAll('[data-year]')) el.textContent = new Date().getFullYear();

// ---------- language menu: links to the other language versions ----------
const langBtn = document.querySelector('.lang-btn'), langMenu = document.querySelector('.lang-menu');
const langLinks = langMenu ? [...langMenu.querySelectorAll('a')] : [];
function openLang() {
  langMenu.hidden = false;
  langBtn.setAttribute('aria-expanded', 'true');
  (langLinks.find((a) => a.getAttribute('aria-current')) || langLinks[0]).focus();
}
function closeLang(refocus) {
  if (langMenu.hidden) return;
  langMenu.hidden = true;
  langBtn.setAttribute('aria-expanded', 'false');
  if (refocus) langBtn.focus();
}
if (langBtn && langMenu) {
  langBtn.addEventListener('click', () => (langMenu.hidden ? openLang() : closeLang(false)));
  langBtn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openLang();
    }
  });
  langMenu.addEventListener('keydown', (e) => {
    const i = langLinks.indexOf(document.activeElement);
    const go = (j) => {
      e.preventDefault();
      langLinks[(j + langLinks.length) % langLinks.length].focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(langLinks.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      closeLang(true);
    } else if (e.key === 'Tab') closeLang(false);
  });
  // remember the choice, so a later visit to an English page offers the same language
  for (const a of langLinks) a.addEventListener('click', () => store(LKEY, a.dataset.lang));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.lang')) closeLang(false);
  });
}

// A returning visitor who picked another language lands on an English page (for
// example by typing the address): take them to their language. Search engines
// keep no storage, so they always see the page they asked for.
const pref = stored(LKEY);
if (pref && pref !== 'en' && root.lang === 'en') {
  const target = langLinks.find((a) => a.dataset.lang === pref);
  if (target) location.replace(target.href);
}

// ---------- share: WhatsApp, LinkedIn, X and Facebook are plain links (filled in at
// build time); Instagram has no web share link, so its button copies a ready caption
// (and opens the phone's share sheet where there is one); "Copy link" copies the address.
const shareBox = document.querySelector('.share');
if (shareBox) {
  const templates = JSON.parse(document.getElementById('share-data')?.textContent || '{}');
  const canonical = document.querySelector('link[rel=canonical]')?.href || '';
  // before the site has its real address (or on a test server), share the page being viewed
  const pageUrl = canonical && !canonical.includes('example.com') ? canonical : location.href.split('#')[0];
  const fill = (t) => (t || '').replaceAll('{url}', pageUrl);
  if (pageUrl !== canonical) {
    const enc = encodeURIComponent;
    const set = (cls, href) => { const a = shareBox.querySelector(`.share-btn.${cls}`); if (a) a.href = href; };
    set('linkedin', 'https://www.linkedin.com/feed/?shareActive=true&text=' + enc(fill(templates.linkedin)));
    set('whatsapp', 'https://wa.me/?text=' + enc(fill(templates.whatsapp)));
    set('x', 'https://x.com/intent/post?text=' + enc(templates.x || '') + '&url=' + enc(pageUrl));
    set('facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + enc(pageUrl));
  }
  const toast = shareBox.querySelector('.share-toast');
  let toastTimer = 0;
  const say = (msg) => {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  };
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // older browsers, or no clipboard permission: a hidden text box
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  };
  shareBox.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-share]');
    if (!b) return;
    if (b.dataset.share === 'copy') {
      if (await copy(pageUrl)) say(shareBox.dataset.copied);
    } else if (b.dataset.share === 'instagram') {
      const caption = fill(templates.instagram);
      if (await copy(caption)) say(shareBox.dataset.ig);
      // phones: offer the share sheet, which includes Instagram
      if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ text: caption }).catch(() => {});
    }
  });
}
