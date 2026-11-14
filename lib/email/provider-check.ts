import { isEmailConfigured } from './index';

/**
 * Asks the e-mail provider (Brevo) whether it accepts the configured key — run by the production
 * build BEFORE anything goes live (`scripts/check-email-provider.ts`).
 *
 * Why: as soon as BREVO_API_KEY and MAIL_FROM are set, customers must confirm their e-mail before
 * their identity can be verified. If Brevo refuses the key (revoked key, or Brevo's "Authorised IPs"
 * blocking — the host has no fixed IP), no confirmation e-mail can leave and every new customer is
 * stuck. A refused key therefore stops the build (`fail`); the version already online stays up.
 * Anything uncertain (provider unreachable, sender not listed) only warns.
 *
 * The key is never part of a message.
 */
export type ProviderCheck = { level: 'skip' | 'ok' | 'warn' | 'fail'; message: string };

const API = 'https://api.brevo.com/v3';

async function call(path: string, apiKey: string): Promise<{ status: number; body: unknown }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(`${API}${path}`, { headers: { 'api-key': apiKey, accept: 'application/json' }, signal: ctl.signal, cache: 'no-store' });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkEmailProvider(): Promise<ProviderCheck> {
  if (!isEmailConfigured()) {
    return { level: 'skip', message: 'e-mail sending is not configured (BREVO_API_KEY, MAIL_FROM): nothing is sent and e-mail confirmation is not enforced.' };
  }
  const apiKey = process.env.BREVO_API_KEY!.trim();
  const from = process.env.MAIL_FROM!.trim().toLowerCase();

  let account: { status: number; body: unknown };
  try {
    account = await call('/account', apiKey);
  } catch (e) {
    return { level: 'warn', message: `could not reach Brevo (${e instanceof Error ? e.name : 'error'}): the key was not checked.` };
  }
  if (account.status === 401 || account.status === 403) {
    const said = String((account.body as { message?: unknown } | null)?.message ?? '').slice(0, 300);
    const hint = /\bIP\b/i.test(said)
      ? ' Brevo is blocking unknown IP addresses and this host has no fixed IP: switch that blocking off (Brevo > Security > Authorised IPs).'
      : ' Create a new key (Brevo > SMTP & API > API keys) and update BREVO_API_KEY.';
    return {
      level: 'fail',
      message: `Brevo refuses BREVO_API_KEY (HTTP ${account.status}${said ? `: ${said}` : ''}).${hint} With this key no confirmation e-mail can be sent, so customers could not get their identity verified.`,
    };
  }
  if (account.status !== 200) return { level: 'warn', message: `Brevo answered HTTP ${account.status}: the key was not checked.` };

  try {
    const senders = await call('/senders', apiKey);
    const list = (senders.body as { senders?: { email?: string; active?: boolean }[] } | null)?.senders;
    if (senders.status === 200 && Array.isArray(list)) {
      const mine = list.find((s) => String(s.email ?? '').toLowerCase() === from);
      if (!mine) return { level: 'warn', message: 'Brevo accepts the key, but MAIL_FROM is not one of the senders of this Brevo account: sends may be refused.' };
      if (!mine.active) return { level: 'warn', message: 'Brevo accepts the key, but the MAIL_FROM sender is not verified yet in Brevo: sends may be refused.' };
    }
  } catch {
    /* the key is accepted; the sender list is a bonus */
  }
  return { level: 'ok', message: 'Brevo accepts the key and the sender is active.' };
}
