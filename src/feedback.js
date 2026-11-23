// "Send feedback": a small form in the game (start page, pause screen, results screen; the
// website footer links to play.html?feedback=1). It is sent the way airacode.online sends its
// contact form: first to our own server route, /api/feedback (api/feedback.js), which mails
// the team through Resend with the sender as reply-to and sends the sender a receipt; if
// that route is not there or cannot send (local development, no API key), through
// FormSubmit instead, which emails the same message as a table. A hidden "honeypot" field
// drops spam bots on both paths.
import { track } from './analytics.js';

const API = '/api/feedback';
const FALLBACK = 'https://formsubmit.co/ajax/nagarajendra432@gmail.com';
const KINDS = [['bug', 'Something is broken'], ['idea', 'An idea'], ['route', 'A route I want'], ['other', 'Something else']];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function version() {
  return document.querySelector('meta[name="sawari-version"]')?.content || 'unknown';
}

// Opens the form over whatever is on screen. `context` adds what the player was doing
// (route, score...) to the email. Returns when the form is closed.
export function openFeedback(context = {}) {
  if (document.querySelector('.feedback-overlay')) return;
  let name = '', email = '';
  try {
    name = localStorage.getItem('sawari-name') || '';
    email = localStorage.getItem('sawari-email') || '';
  } catch {
    /* no storage */
  }
  const o = document.createElement('div');
  o.className = 'overlay feedback-overlay';
  o.innerHTML = `<form class="dialog feedback" novalidate>
    <h2>Send feedback</h2>
    <p class="sub">Found a bug, have an idea, or want a route added? It goes straight to the team at AiraCode Technologies.</p>
    <fieldset class="fb-kind"><legend>What is it about?</legend>
      ${KINDS.map(([v, l], i) => `<label><input type="radio" name="kind" value="${v}" ${i === 0 ? 'checked' : ''} /> ${l}</label>`).join('')}
    </fieldset>
    <label class="fb-field">Your message<textarea name="message" rows="5" maxlength="3000" required placeholder="What happened, or what would you like? For a bug: which route and what you were doing helps a lot."></textarea></label>
    <div class="fb-row">
      <label class="fb-field">Name <span>(optional)</span><input name="name" maxlength="60" autocomplete="name" value="${esc(name)}" /></label>
      <label class="fb-field">Email <span>(optional, only to reply to you)</span><input name="email" type="email" maxlength="120" autocomplete="email" value="${esc(email)}" /></label>
    </div>
    <input class="fb-hp" name="_honey" tabindex="-1" autocomplete="off" aria-hidden="true" />
    <p class="fb-note">We also send the route, Sawari version, device and screen size, so we can reproduce problems. Nothing else.</p>
    <p class="fb-msg" role="status" aria-live="polite"></p>
    <div class="actions"><button class="primary" type="submit">Send</button><button class="secondary" type="button" data-close>Close</button></div>
  </form>`;
  document.body.appendChild(o);
  const form = o.querySelector('form'), msg = o.querySelector('.fb-msg'), send = form.querySelector('[type=submit]');
  const close = () => o.remove();
  o.addEventListener('click', (e) => { if (e.target === o || e.target.closest('[data-close]')) close(); });
  o.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); e.stopPropagation(); }); // keys type here, not drive the car
  o.addEventListener('keyup', (e) => e.stopPropagation());
  setTimeout(() => form.querySelector('textarea').focus(), 50);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    if (f.get('_honey')) return close(); // a bot filled the hidden field
    const message = String(f.get('message') || '').trim();
    const from = String(f.get('email') || '').trim(), who = String(f.get('name') || '').trim();
    const kind = String(f.get('kind') || 'other');
    if (message.length < 3) { msg.textContent = 'Please write a few words first.'; return; }
    if (from && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) { msg.textContent = 'That email address does not look right (or leave it empty).'; return; }
    try {
      if (who) localStorage.setItem('sawari-name', who.slice(0, 24));
      if (from) localStorage.setItem('sawari-email', from);
    } catch {
      /* no storage */
    }
    const label = KINDS.find(([v]) => v === kind)?.[1] || kind;
    const route = context.route || new URLSearchParams(location.search).get('route') || 'none';
    const body = {
      _subject: `Sawari feedback: ${label}${route !== 'none' ? ` (${route})` : ''}`,
      _template: 'table',
      _captcha: 'false',
      Type: label,
      Message: message,
      Name: who || 'Not given',
      Email: from || 'Not given',
      Route: route,
      ...Object.fromEntries(Object.entries(context).filter(([k]) => k !== 'route').map(([k, v]) => [k[0].toUpperCase() + k.slice(1), String(v)])),
      Version: version(),
      Device: matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard/mouse',
      Screen: `${screen.width}x${screen.height} (window ${innerWidth}x${innerHeight})`,
      Browser: navigator.userAgent,
      Page: location.href.split('#')[0],
    };
    if (from) {
      body._replyto = from;
      body._autoresponse = `Hi ${who.split(/\s+/)[0] || 'there'},\n\nThanks for your feedback on Sawari. We read every message, and we'll reply to this address if we need to know more.\n\nThe Sawari team at AiraCode Technologies\nhttps://sawari.airacode.online`;
    }
    send.disabled = true;
    msg.textContent = 'Sending…';
    try {
      // 1. our own route (Resend), as airacode.online does
      const details = Object.fromEntries(Object.entries(body).filter(([k]) => !k.startsWith('_') && !['Type', 'Message', 'Name', 'Email', 'Route'].includes(k)));
      let res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, message, name: who, email: from, route, details, botField: f.get('_honey') || '' }),
      }).catch(() => null);
      let via = 'resend';
      // 2. not there, or it could not send: FormSubmit, as airacode.online falls back
      if (!res || !res.ok) {
        if (res && res.status === 400) throw new Error((await res.json().catch(() => ({}))).error || 'Bad request');
        via = 'formsubmit';
        res = await fetch(FALLBACK, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === 'false' || data.success === false) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      track('feedback_sent', { kind, route, via });
      form.innerHTML = `<h2>Thank you</h2><p class="sub">Your feedback is on its way to the team.${from ? ' We\'ll reply to you by email if we need to know more.' : ''}</p><div class="actions"><button class="primary" type="button" data-close>Close</button></div>`;
    } catch {
      send.disabled = false;
      msg.textContent = 'Sorry, that did not send. Please try again, or email contact@airacode.online.';
    }
  });
}
