/**
 * Transactional e-mail (account confirmation, identity verification). Provider: Brevo's transactional API.
 *
 *   BREVO_API_KEY    API key (Brevo → SMTP & API → API keys). Secret: hosting environment only.
 *   MAIL_FROM        sender address — must be a sender verified in Brevo
 *   MAIL_FROM_NAME   optional, default "DOOM | دوم"
 *
 * Not configured → nothing is sent and the caller is told (`skipped`); an e-mail is never faked. A failed
 * send never breaks the action that triggered it (registration, identity submission, decision).
 */
export type EmailAddress = { email: string; name?: string | null };
export type EmailMessage = { to: EmailAddress[]; subject: string; html: string; text: string; tag: string };
export type SendResult = { ok: true; id: string | null } | { ok: false; skipped: true } | { ok: false; skipped: false; error: string };

function env() {
  return {
    apiKey: process.env.BREVO_API_KEY?.trim() || '',
    from: process.env.MAIL_FROM?.trim() || '',
    fromName: process.env.MAIL_FROM_NAME?.trim() || 'DOOM | دوم',
  };
}

export function isEmailConfigured(): boolean {
  const e = env();
  return !!(e.apiKey && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.from));
}

export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const e = env();
  if (!isEmailConfigured()) return { ok: false, skipped: true };
  const to = msg.to.filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)).map((r) => ({ email: r.email, ...(r.name ? { name: r.name.slice(0, 70) } : {}) }));
  if (to.length === 0) return { ok: false, skipped: false, error: 'no_recipient' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': e.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { email: e.from, name: e.fromName }, to, subject: msg.subject, htmlContent: msg.html, textContent: msg.text, tags: [msg.tag] }),
      signal: ctl.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error(`[email] ${msg.tag} not sent: HTTP ${res.status}`);
      return { ok: false, skipped: false, error: `http_${res.status}` };
    }
    const body = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { ok: true, id: body.messageId ?? null };
  } catch (err) {
    console.error(`[email] ${msg.tag} not sent:`, err instanceof Error ? err.message : err);
    return { ok: false, skipped: false, error: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function appUrl(path = ''): string {
  return `${(process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '')}${path}`;
}

/** Simple, accessible, brand-coloured layout; RTL for Arabic. Every dynamic value is escaped by the caller via `escapeHtml`. */
export function layout(opts: { locale: string; title: string; paragraphs: string[]; button?: { label: string; url: string }; footer: string }): { html: string; text: string } {
  const rtl = opts.locale === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const font = rtl ? "'IBM Plex Sans Arabic', Tahoma, Arial, sans-serif" : "'IBM Plex Sans', Arial, sans-serif";
  const html = `<!doctype html><html lang="${opts.locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#FDFAF6;font-family:${font};color:#0A1937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FDFAF6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E4E1DA;border-radius:16px">
<tr><td style="padding:20px 24px;background:#FEE225;border-radius:16px 16px 0 0;font-size:20px;font-weight:700;color:#0A1937;text-align:${align}" dir="${dir}">DOOM | دوم</td></tr>
<tr><td style="padding:24px;text-align:${align}" dir="${dir}">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.4">${escapeHtml(opts.title)}</h1>
${opts.paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#334155">${p}</p>`).join('\n')}
${opts.button ? `<p style="margin:20px 0"><a href="${escapeHtml(opts.button.url)}" style="display:inline-block;background:#FEE225;color:#0A1937;border:1px solid #0A1937;border-radius:12px;padding:12px 20px;font-weight:700;text-decoration:none">${escapeHtml(opts.button.label)}</a></p>
<p style="margin:0 0 12px;font-size:12px;line-height:1.6;color:#475569;word-break:break-all" dir="ltr">${escapeHtml(opts.button.url)}</p>` : ''}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #E4E1DA;font-size:12px;line-height:1.6;color:#475569;text-align:${align}" dir="${dir}">${escapeHtml(opts.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = [opts.title, '', ...opts.paragraphs.map(strip), ...(opts.button ? ['', `${opts.button.label}: ${opts.button.url}`] : []), '', opts.footer].join('\n');
  return { html, text };
}
