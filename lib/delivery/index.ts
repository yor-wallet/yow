/**
 * DOOM EXPRESS — delivery engine (logistics module). Public API:
 *
 *   quoteDelivery({ wilayaId | governorateId | zoneId, weightGrams, volumeCm3, type, subtotalBaisa?, expressEligible?, at? })
 *     → { available, feeBaisa?, etaHours?, promisedBy?, reason?, zoneId?, breakdown? }
 *   quoteDeliveryOptions(...)          both types at once
 *   aggregateParcel(lines)             sum weight/volume of cart lines (unknown ⇒ null)
 *   createShipmentForOrder(orderId, tx) called by lib/orders markOrderPaid (idempotent)
 *   transitionShipment / assignCourier / completeDelivery / regenerateHandoverOtp
 *   reportIncident / resolveIncident
 *   toAddressSnapshot / parseAddressSnapshot (Order.addressSnapshot contract)
 *
 * See docs/DELIVERY.md.
 */
export * from './quote';
export * from './settings';
export * from './shipments';
export * from './addresses';
export * from './otp';
export * from './time';
export { getGovernorateOptions, type GovernorateOption, type WilayaOption } from './geo';
export { listZoneSummaries, type ZoneSummary } from './zones';
export { validateImage, isHeic, IMAGE_MAX_BYTES, ALLOWED_IMAGE_MIME } from './images';
export { readProofPhoto } from './proof';
