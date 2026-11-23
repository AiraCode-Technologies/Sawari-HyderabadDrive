// POST /api/feedback: Sawari's "Send feedback" form, mailed the way airacode.online mails its
// contact form (AiraCode-Technologies/Airacode-Website, src/app/api/contact/route.ts):
// through Resend, as an HTML notification to the team (reply-to: the sender) and, when the
// sender gave an email, a confirmation receipt to them; a honeypot drops bots; every value
// is escaped before it goes into the email.
//
// Environment (the same names as airacode.online, so the same Resend key works):
//   RESEND_API_KEY               required; without it this route answers 503 and the game
//                                falls back to FormSubmit, so no feedback is ever lost
//   CONTACT_RECIPIENT_EMAIL      default contact@airacode.online
//   TEAM_ALERT_EMAIL             default nagarajendra432@gmail.com (also notified)
//   CONTACT_FROM_EMAIL           default "Sawari <contact@airacode.online>" (a domain verified in Resend)
//   CONTACT_FALLBACK_FROM_EMAIL  default "Sawari <onboarding@resend.dev>" (used if the first is refused)
export const config = { runtime: 'edge' };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const KINDS = { bug: 'Something is broken', idea: 'An idea', route: 'A route I want', other: 'Something else' };
const ORANGE = '#f2a93b';

async function send(key, mail, fallbackFrom) {
  const post = (m) =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(m),
    });
  let res = await post(mail);
  if (!res.ok) {
    console.warn('Primary sender refused, trying the fallback sender:', res.status, await res.text().catch(() => ''));
    res = await post({ ...mail, from: fallbackFrom });
  }
  return res.ok;
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ success: false, error: 'Use POST.' }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Bad request.' }, 400);
  }
  // honeypot: a bot filled the hidden field; pretend all is well
  if (body.botField) return json({ success: true, message: 'Feedback received.' });

  const message = String(body.message ?? '').trim().slice(0, 3000);
  const email = String(body.email ?? '').trim().slice(0, 120);
  const name = String(body.name ?? '').trim().slice(0, 60);
  if (message.length < 3) return json({ success: false, error: 'Please write a few words.' }, 400);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ success: false, error: 'That email address does not look right.' }, 400);

  const key = process.env.RESEND_API_KEY;
  if (!key) return json({ success: false, error: 'Mail is not configured.' }, 503); // the game falls back to FormSubmit

  const kind = KINDS[body.kind] ? body.kind : 'other';
  const id = 'SAW-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const when = new Date().toUTCString();
  const details = Object.entries(body.details && typeof body.details === 'object' ? body.details : {})
    .slice(0, 16)
    .map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 400)]);
  const route = String(body.route || 'none').slice(0, 40);
  const recipient = process.env.CONTACT_RECIPIENT_EMAIL || 'contact@airacode.online';
  const alert = process.env.TEAM_ALERT_EMAIL || 'nagarajendra432@gmail.com';
  const team = [recipient, ...(alert && alert !== recipient ? [alert] : [])];
  const from = process.env.CONTACT_FROM_EMAIL || 'Sawari <contact@airacode.online>';
  const fallbackFrom = process.env.CONTACT_FALLBACK_FROM_EMAIL || 'Sawari <onboarding@resend.dev>';

  const row = (k, v, strong) => `<tr><td style="padding: 7px 0; color: #6b7280; width: 130px; font-weight: bold; vertical-align: top;">${esc(k)}:</td><td style="padding: 7px 0; color: #1e2530;${strong ? ' font-weight: 600;' : ''}">${v}</td></tr>`;
  const teamHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #faf8f5; border-radius: 16px; border: 1px solid #ede9e0;">
      <div style="border-bottom: 2px solid ${ORANGE}; padding-bottom: 12px; margin-bottom: 20px;">
        <h2 style="color: #1e2530; margin: 0; font-size: 22px;">Sawari feedback: ${esc(KINDS[kind])}</h2>
        <p style="color: #6b7280; margin: 4px 0 0 0; font-size: 13px; font-family: monospace;">ID: ${id} | ${esc(when)}</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
        ${row('Name', esc(name || 'Not given'), true)}
        ${row('Email', email ? `<a href="mailto:${esc(email)}" style="color: #b86e05; text-decoration: none; font-weight: 600;">${esc(email)}</a>` : 'Not given')}
        ${row('Type', esc(KINDS[kind]), true)}
        ${row('Route', esc(route))}
        ${details.map(([k, v]) => row(k, esc(v))).join('')}
      </table>
      <div style="background: #ffffff; padding: 16px; border-radius: 12px; border: 1px solid #ede9e0; margin-bottom: 20px;">
        <h4 style="margin: 0 0 8px 0; color: #1e2530; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Message:</h4>
        <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${esc(message)}</p>
      </div>
      <div style="font-size: 12px; color: #9ca3af; text-align: center; border-top: 1px solid #ede9e0; padding-top: 16px;">Sent from the Sawari feedback form · sawari.airacode.online</div>
    </div>`;

  const first = esc(name.split(/\s+/)[0] || 'there');
  const userHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 28px; background: #faf8f5; border-radius: 16px; border: 1px solid #ede9e0; color: #1e2530;">
      <h2 style="margin: 0 0 4px 0; font-size: 22px; font-weight: 800; letter-spacing: 3px;">SAWARI</h2>
      <p style="margin: 0 0 24px 0; font-size: 13px; color: #6b7280;">Drive Hyderabad · by AiraCode Technologies</p>
      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Hi ${first},</p>
      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 20px 0; color: #374151;">Thanks for your feedback on Sawari. It has reached the team, and we read every message.</p>
      <div style="background: #ffffff; border: 1px solid #ede9e0; border-radius: 12px; padding: 16px 18px; margin-bottom: 20px;">
        <p style="margin: 0 0 6px 0; font-size: 14px; font-weight: 700;">Your message (${esc(KINDS[kind])})</p>
        <p style="margin: 0; white-space: pre-wrap; line-height: 1.5; font-size: 14px; color: #374151;">${esc(message)}</p>
      </div>
      <p style="font-size: 14px; line-height: 1.6; margin: 0 0 20px 0; color: #374151;">Want to add screenshots or more detail? Just reply to this email.</p>
      <p style="font-size: 14px; margin: 0; color: #374151;">Happy driving,<br/>The Sawari team at AiraCode Technologies</p>
      <p style="margin: 24px 0 0 0; padding-top: 16px; border-top: 1px solid #ede9e0; font-size: 12px; color: #9ca3af; text-align: center;">
        <a href="https://sawari.airacode.online" style="color: #b86e05; text-decoration: none;">sawari.airacode.online</a> · <a href="https://airacode.online" style="color: #6b7280; text-decoration: none;">airacode.online</a>
      </p>
    </div>`;

  // 1. the team notification (this one must go through)
  let teamOk = false;
  try {
    teamOk = await send(key, {
      from, to: team, ...(email ? { reply_to: email } : {}),
      subject: `Sawari feedback: ${KINDS[kind]}${route !== 'none' ? ` (${route})` : ''}${name ? ` from ${name}` : ''}`,
      html: teamHtml,
    }, fallbackFrom);
  } catch (e) {
    console.error('Team notification failed:', e);
  }
  if (!teamOk) return json({ success: false, error: 'Mail could not be sent.' }, 502); // the game falls back to FormSubmit

  // 2. a receipt for the sender, if they gave an email (best effort)
  if (email) {
    try {
      await send(key, { from, to: email, reply_to: recipient, subject: 'Thanks for your feedback on Sawari', html: userHtml }, fallbackFrom);
    } catch (e) {
      console.error('Confirmation failed:', e);
    }
  }
  return json({ success: true, message: 'Thanks! Your feedback is with the team.', id });
}
