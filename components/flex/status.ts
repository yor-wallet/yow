import type { BadgeVariant } from '@/components/ui/Badge';

export const FLEX_STATUS_VARIANT: Record<string, BadgeVariant> = {
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  APPROVED: 'warning',
  ACCEPTED: 'primary',
  ACTIVE: 'primary',
  COMPLETED: 'success',
  REJECTED: 'error',
  DEFAULTED: 'error',
  CANCELLED: 'neutral',
};
