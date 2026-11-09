import { PAYMENT_METHOD_ORDER, type OrderPaymentPort } from './payment-port';

/**
 * Binding of the storefront payment port. Until the money module's registry is wired,
 * every method reports `not_configured` (shown disabled with an explanation) and no
 * payment can start — never simulated.
 */
const notConfigured: OrderPaymentPort = {
  async listPaymentMethods() {
    return PAYMENT_METHOD_ORDER.map((id) => ({ id, available: false, reason: 'not_configured' }));
  },
  async startOrderPayment() {
    return { status: 'failed', reason: 'not_configured' };
  },
};

export function getPaymentPort(): OrderPaymentPort {
  return notConfigured;
}
