/**
 * Payments (money module). Server-side only. See docs/PAYMENTS.md.
 *
 *   listPaymentMethods({ purpose, amountBaisa, userId })      registry: availability per method
 *   startOrderPayment(orderId, methodId, userId, idempotencyKey)
 *   startTopUp(userId, methodId, amountBaisa, idempotencyKey)
 *   confirmPaymentIntent(intentId, { confirmedAmountBaisa, providerRef, source })   the ONLY "succeeded" path
 *   refreshPaymentIntent(intentId)                             server-side provider status check
 *   handleProviderWebhook(slug, headers, rawBody)              /api/webhooks/<slug>
 *   submitGiftCard / reviewGiftCard / revealGiftCardCode / getGiftCardImage / listGiftCardsForReview
 *   refundOrder({ orderId, amountBaisa, reason, actorId })
 */
export { listPaymentMethods, getAdapter, getAdapterBySlug, ADAPTERS, METHODS_BY_PURPOSE } from './registry';
export {
  startOrderPayment,
  startTopUp,
  confirmPaymentIntent,
  refreshPaymentIntent,
  closePendingIntent,
  getPaymentIntentView,
  expireStalePaymentIntents,
  resultFromIntent,
  ledgerReference,
} from './core';
export type { ConfirmArgs, ConfirmResult, PaymentIntentView } from './core';
export { handleProviderWebhook } from './webhooks';
export {
  submitGiftCard,
  reviewGiftCard,
  revealGiftCardCode,
  getGiftCardImage,
  listGiftCardsForReview,
  giftCardInputSchema,
  parseMinorUnits,
  GIFT_CARD_BRANDS,
  GIFT_CARD_CURRENCIES,
  MAX_OPEN_GIFT_CARDS,
} from './giftcards';
export type { GiftCardBrand, GiftCardCurrency, GiftCardInput, ReviewDecision, ReviewGiftCardResult, SubmitGiftCardResult } from './giftcards';
export { refundOrder } from './refunds';
export type { RefundOrderInput, RefundOrderResult } from './refunds';
export { raisePaymentAlert } from './alerts';
export * from './types';
export { MoneyError, isMoneyError } from '@/lib/wallet/errors';
export type { MoneyErrorCode } from '@/lib/wallet/errors';
