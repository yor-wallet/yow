import { defineAgent } from '../framework';
import { AGENT_INTERVALS } from '../schedule';
import { ago, DAY, HOUR, MINUTE, top } from '../util';

/**
 * 6 · Payment monitoring — stuck PENDING/REQUIRES_ACTION intents, failure spikes,
 * confirmed-amount mismatches and webhook events whose signature failed verification.
 * Never confirms or cancels anything: it can only propose `payment.flag` for review.
 */
export default defineAgent({
  key: 'payments',
  number: 6,
  nameKey: 'payments',
  scopes: ['paymentIntent', 'paymentProviderEvent'],
  schedule: { everyMinutes: AGENT_INTERVALS.payments },
  async run(ctx) {
    const now = ctx.now;
    const stuckMinutes = ctx.settings['payments.stuckPendingMinutes'];
    const stuck = await ctx.db.paymentIntent.findMany({
      where: { status: { in: ['PENDING', 'REQUIRES_ACTION'] }, createdAt: { lt: ago(now, stuckMinutes * MINUTE) } },
      select: { id: true, provider: true, purpose: true, amountBaisa: true, createdAt: true, userId: true, metadata: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    ctx.metric('stuck', stuck.length);
    for (const p of stuck) {
      const flagged = !!(p.metadata && typeof p.metadata === 'object' && (p.metadata as Record<string, unknown>).flagged);
      if (flagged) continue;
      const ageMin = Math.round((now.getTime() - p.createdAt.getTime()) / MINUTE);
      ctx.propose({
        severity: ageMin > 24 * 60 ? 'HIGH' : 'MEDIUM',
        titleKey: 'payments.stuck',
        params: { provider: p.provider, minutes: ageMin },
        title: `${p.provider} payment pending for ${ageMin} min`,
        details: { paymentIntentId: p.id, provider: p.provider, purpose: p.purpose, amountBaisa: p.amountBaisa, userId: p.userId, createdAt: p.createdAt.toISOString() },
        action: { type: 'payment.flag', params: { paymentIntentId: p.id, reason: 'stuck_pending' } },
        fingerprint: `stuck:${p.id}`,
      });
    }

    // Failure spike: last hour vs hourly average of the previous 24h.
    const [lastHour, prevDay] = await Promise.all([
      ctx.db.paymentIntent.count({ where: { status: 'FAILED', updatedAt: { gte: ago(now, HOUR) } } }),
      ctx.db.paymentIntent.count({ where: { status: 'FAILED', updatedAt: { gte: ago(now, 25 * HOUR), lt: ago(now, HOUR) } } }),
    ]);
    const baseline = prevDay / 24;
    ctx.metric('failedLastHour', lastHour);
    ctx.metric('failedHourlyBaseline', Math.round(baseline * 100) / 100);
    if (lastHour >= 5 && lastHour > 3 * baseline) {
      const byProvider = await ctx.db.paymentIntent.groupBy({
        by: ['provider'],
        where: { status: 'FAILED', updatedAt: { gte: ago(now, HOUR) } },
        _count: { _all: true },
      });
      ctx.propose({
        severity: 'HIGH',
        titleKey: 'payments.failureSpike',
        params: { count: lastHour },
        title: `Payment failure spike: ${lastHour} failures in the last hour`,
        details: { lastHour, baselinePerHour: Math.round(baseline * 100) / 100, byProvider: byProvider.map((b) => ({ provider: b.provider, count: b._count._all })) },
        fingerprint: 'failure-spike',
      });
    }

    // Confirmed amount differs from the requested amount.
    const succeeded = await ctx.db.paymentIntent.findMany({
      where: { status: 'SUCCEEDED', confirmedAmountBaisa: { not: null }, updatedAt: { gte: ago(now, 30 * DAY) } },
      select: { id: true, provider: true, amountBaisa: true, confirmedAmountBaisa: true, metadata: true },
      take: 5000,
    });
    for (const p of succeeded) {
      if (p.confirmedAmountBaisa === p.amountBaisa) continue;
      const flagged = !!(p.metadata && typeof p.metadata === 'object' && (p.metadata as Record<string, unknown>).flagged);
      if (flagged) continue;
      ctx.propose({
        severity: 'CRITICAL',
        titleKey: 'payments.amountMismatch',
        params: { provider: p.provider },
        title: `${p.provider} payment confirmed for a different amount`,
        details: { paymentIntentId: p.id, amountBaisa: p.amountBaisa, confirmedAmountBaisa: p.confirmedAmountBaisa },
        action: { type: 'payment.flag', params: { paymentIntentId: p.id, reason: 'amount_mismatch' } },
        fingerprint: `mismatch:${p.id}`,
      });
    }

    // Webhook signature failures (possible forgery or misconfigured secret).
    const badSig = await ctx.db.paymentProviderEvent.groupBy({
      by: ['provider'],
      where: { signatureVerified: false, receivedAt: { gte: ago(now, DAY) } },
      _count: { _all: true },
    });
    ctx.metric('signatureFailures24h', badSig.reduce((s, b) => s + b._count._all, 0));
    for (const b of badSig) {
      const sample = await ctx.db.paymentProviderEvent.findMany({
        where: { provider: b.provider, signatureVerified: false, receivedAt: { gte: ago(now, DAY) } },
        select: { id: true, eventId: true, receivedAt: true },
        orderBy: { receivedAt: 'desc' },
        take: 5,
      });
      ctx.propose({
        severity: b._count._all >= 10 ? 'CRITICAL' : 'HIGH',
        titleKey: 'payments.signatureFailures',
        params: { provider: b.provider, count: b._count._all },
        title: `${b._count._all} ${b.provider} webhook(s) failed signature verification`,
        details: { provider: b.provider, count: b._count._all, sample: top(sample.map((s) => ({ ...s, receivedAt: s.receivedAt.toISOString() })), 5) },
        fingerprint: `bad-signature:${b.provider}`,
      });
    }
  },
});
