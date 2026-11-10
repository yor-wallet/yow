/**
 * DOOM FLEX (money module). See docs/PAYMENTS.md → DOOM FLEX.
 */
export { computeSchedule, isFlexMonths, muscatToday, dateOnly, FLEX_MONTHS } from './schedule';
export type { FlexMonths, FlexScheduleResult, ScheduledInstallment } from './schedule';
export {
  FLEX_TERMS_VERSION,
  MAX_OPEN_FLEX,
  FLEX_APPROVAL_VALID_DAYS,
  getFlexEligibility,
  getFlexProduct,
  applyForFlex,
  decideFlexApplication,
  quoteFlexAcceptance,
  acceptFlexTerms,
  cancelFlexApplication,
  payInstallment,
  findOverdueInstallments,
  markOverdueInstallments,
  listFlexApplications,
  getFlexApplication,
  applyPartnerDecision,
} from './service';
export type {
  FlexEligibility,
  FlexIneligibleReason,
  FlexProduct,
  ApplyResult,
  FlexDecision,
  FlexAcceptQuote,
  AcceptResult,
  OverdueInstallment,
  FlexApplicationDetail,
} from './service';
export { isFlexPartnerConfigured, flexPartnerName, verifyPartnerWebhook } from './partner';
