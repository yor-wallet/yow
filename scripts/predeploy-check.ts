/**
 * Pre-deployment check: validates the PRODUCTION environment before the first deploy.
 *
 *   npx tsx scripts/predeploy-check.ts            # reads the current environment (or .env.production.local)
 *   npm run predeploy
 *
 * Fails (exit 1) on anything that would leak data or break payments; warns about optional pieces.
 * Prints names and lengths only — never values.
 */
try {
  process.loadEnvFile?.('.env.production.local');
} catch {
  /* rely on the process environment */
}

const env = process.env;
const errors: string[] = [];
const warns: string[] = [];
const need = (k: string, why: string) => {
  if (!env[k]?.trim()) errors.push(`${k} is missing — ${why}`);
  return env[k]?.trim() ?? '';
};

const appUrl = need('APP_URL', 'public https URL of the site');
if (appUrl && !/^https:\/\/[^\s/]+$/.test(appUrl)) errors.push('APP_URL must be https and without a trailing slash (e.g. https://doom.om)');

const db = need('DATABASE_URL', 'PostgreSQL connection string');
if (db && /localhost|127\.0\.0\.1/.test(db)) errors.push('DATABASE_URL points to localhost');
if (db && /supabase\.co:5432|pooler\.supabase\.com:5432/.test(db) && !/pgbouncer=true/.test(db)) warns.push('Supabase: use the pooled URL (port 6543, ?pgbouncer=true&connection_limit=1) at runtime and the direct URL only for `prisma migrate deploy`.');

const session = need('SESSION_SECRET', 'openssl rand -base64 48');
if (session && session.length < 32) errors.push('SESSION_SECRET is shorter than 32 characters');
const kyc = need('KYC_ENCRYPTION_KEY', 'openssl rand -base64 32 — back it up offline: losing it makes KYC files unreadable');
if (kyc) {
  const bytes = /^[0-9a-fA-F]{64}$/.test(kyc) ? 32 : Buffer.from(kyc, 'base64').length;
  if (bytes !== 32) errors.push('KYC_ENCRYPTION_KEY must decode to exactly 32 bytes');
}
const cron = need('CRON_SECRET', 'protects /api/cron/*');
if (cron && cron.length < 24) errors.push('CRON_SECRET is shorter than 24 characters');

if (env.SESSION_COOKIE_SECURE === 'false') errors.push('SESSION_COOKIE_SECURE=false must not be set in production');
if (env.ENABLE_UI_KIT) errors.push('ENABLE_UI_KIT must not be set in production');
if (env.NODE_ENV && env.NODE_ENV !== 'production') warns.push(`NODE_ENV is "${env.NODE_ENV}" (the host sets production at build time)`);

if ((env.STORAGE_DRIVER ?? 'local') === 'local') errors.push('STORAGE_DRIVER=local loses uploads on Vercel (ephemeral disk): use STORAGE_DRIVER=supabase');
else {
  need('SUPABASE_URL', 'storage driver');
  need('SUPABASE_SERVICE_ROLE_KEY', 'storage driver (server only, never NEXT_PUBLIC)');
  if (env.SUPABASE_PUBLIC_BUCKET === env.SUPABASE_PRIVATE_BUCKET) errors.push('public and private buckets must differ (KYC files are private)');
}

if (env.ADMIN_EMAIL && /@doom\.local$|@test\./.test(env.ADMIN_EMAIL)) errors.push('ADMIN_EMAIL is a development address');
if (env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length < 14) errors.push('ADMIN_PASSWORD shorter than 14 characters (only used by the first seed; change it after first login)');

const providers: [string, string[]][] = [
  ['card gateway', ['CARD_GATEWAY_PROVIDER', 'CARD_GATEWAY_SECRET_KEY', 'CARD_GATEWAY_WEBHOOK_SECRET']],
  ['Ooredoo', ['OOREDOO_API_URL', 'OOREDOO_MERCHANT_ID', 'OOREDOO_API_KEY']],
  ['Omantel', ['OMANTEL_API_URL', 'OMANTEL_MERCHANT_ID', 'OMANTEL_API_KEY']],
  ['crypto', ['CRYPTO_PROVIDER', 'CRYPTO_API_KEY', 'CRYPTO_WEBHOOK_SECRET']],
  ['DOOM FLEX partner', ['FLEX_PARTNER_NAME', 'FLEX_PARTNER_API_URL', 'FLEX_PARTNER_API_KEY']],
];
for (const [name, keys] of providers) {
  const set = keys.filter((k) => env[k]?.trim());
  if (set.length === 0) warns.push(`${name}: not configured → shown as "unavailable" in the shop (expected until the contract is signed)`);
  else if (set.length < keys.length) errors.push(`${name}: partially configured (${keys.filter((k) => !env[k]?.trim()).join(', ')} missing)`);
}

for (const w of warns) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(errors.length ? `\n${errors.length} blocking problem(s).` : '\nReady: no blocking problem.');
process.exit(errors.length ? 1 : 0);
