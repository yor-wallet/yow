/**
 * Orders core (storefront module). Public API:
 *   placeOrder(input)                              checkout → PENDING_PAYMENT order + 15-min stock reservation
 *   markOrderPaid(orderId, paymentIntentId, tx)    money module, inside its confirmation transaction
 *   cancelOrder(orderId, opts) / cancelOrderTx     unpaid orders only (releases reservations)
 *   releaseExpiredReservations(now?)               cron
 *   quoteCheckout(req)                             exact amounts placeOrder() would charge
 */
export { placeOrder, RESERVATION_MINUTES, type PlaceOrderInput, type PlacedOrder } from './place';
export { markOrderPaid, cancelOrder, cancelOrderTx, releaseExpiredReservations, type MarkPaidResult, type CancelResult, type CancelOptions } from './lifecycle';
export { quoteCheckout, quoteLines, type CheckoutQuote, type DeliveryOption, type PromoStatus } from './quote';
export { OrderError, isOrderError, type OrderErrorCode } from './errors';
export { generateOrderNumber, isOrderNumber, ORDER_NUMBER_RE } from './number';
export { getPaymentPort } from './payments';
export type { OrderPaymentPort, PaymentMethodStatus, StartOrderPaymentResult, PaymentMethodId } from './payment-port';
