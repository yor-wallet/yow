/**
 * Build-time check of the e-mail provider (see lib/email/provider-check.ts).
 *
 *   npx tsx scripts/check-email-provider.ts
 *
 * Exit 1 only when the provider explicitly refuses the configured key: the build stops and the
 * version already online stays up. SKIP_EMAIL_PROVIDER_CHECK=1 turns a refusal into a warning
 * (emergency deploys only: e-mail confirmation will be required while no e-mail can leave).
 */
import { checkEmailProvider } from '../lib/email/provider-check';

checkEmailProvider()
  .then((r) => {
    const skip = process.env.SKIP_EMAIL_PROVIDER_CHECK === '1';
    console.log(`[email] ${r.level === 'fail' ? (skip ? 'WARNING (check skipped)' : 'ERROR') : r.level.toUpperCase()}: ${r.message}`);
    process.exit(r.level === 'fail' && !skip ? 1 : 0);
  })
  .catch((e) => {
    console.log(`[email] WARN: check not completed (${e instanceof Error ? e.name : 'error'}).`);
    process.exit(0);
  });
