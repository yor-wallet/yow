import { PAYMENT_METHOD_ORDER, type OrderPaymentPort, type StartOrderPaymentResult } from './payment-port';

/**
 * Binding of the storefront payment port to the money module (lib/payments). Modules are
 * imported lazily: lib/payments imports lib/orders (markOrderPaid), so a static import here
 * would create a module cycle. Unconfigured providers come back `available: false` with the
 * money module's reason — never simulated.
 */
const moneyPort: OrderPaymentPort = {
  async listPaymentMethods({ userId, amountBaisa }) {
    const { listPaymentMethods } = await import('@/lib/payments/registry');
    const options = await listPaymentMethods({ purpose: 'ORDER', amountBaisa, userId });
    const order = (id: string) => {
      const i = PAYMENT_METHOD_ORDER.indexOf(id as (typeof PAYMENT_METHOD_ORDER)[number]);
      return i < 0 ? 99 : i;
    };
    return options
      .map((o) => ({ id: o.id, available: o.available, reason: o.available ? null : (o.reason ?? 'not_configured') }))
      .sort((a, b) => order(a.id) - order(b.id));
  },
  async startOrderPayment(orderId, method, ctx): Promise<StartOrderPaymentResult> {
    const [{ startOrderPayment }, { MoneyError }] = await Promise.all([import('@/lib/payments/core'), import('@/lib/wallet/errors')]);
    try {
      const r = await startOrderPayment(orderId, method, ctx.userId, ctx.idempotencyKey, { locale: ctx.locale });
      switch (r.status) {
        case 'redirect':
          return { status: 'redirect', url: r.url, intentId: r.intentId };
        case 'succeeded':
          return { status: 'succeeded', intentId: r.intentId };
        case 'pending':
          return { status: 'pending', intentId: r.intentId };
        default:
          return { status: 'failed', reason: r.reason, intentId: r.intentId ?? null };
      }
    } catch (err) {
      if (err instanceof MoneyError) return { status: 'failed', reason: err.code, intentId: null };
      throw err;
    }
  },
};

export function getPaymentPort(): OrderPaymentPort {
  return moneyPort;
}
