import { useTranslations } from 'next-intl';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';

export type WalletStatusKey = 'confirmed' | 'pending' | 'rejected' | 'underReview' | 'submitted' | 'failed' | 'cancelled' | 'expired';

const VARIANT: Record<WalletStatusKey, BadgeVariant> = {
  confirmed: 'success',
  pending: 'info',
  submitted: 'info',
  underReview: 'warning',
  rejected: 'error',
  failed: 'error',
  cancelled: 'neutral',
  expired: 'neutral',
};

/** Clear status chip: pending / confirmed / rejected (and finer states). */
export function StatusBadge({ status, className }: { status: WalletStatusKey; className?: string }) {
  const t = useTranslations('wallet.status');
  return (
    <Badge variant={VARIANT[status]} className={className} data-status={status}>
      {t(status)}
    </Badge>
  );
}

/** PaymentIntent / gift-card raw status → display status. */
export function displayStatus(raw: string): WalletStatusKey {
  switch (raw) {
    case 'SUCCEEDED':
    case 'VERIFIED':
      return 'confirmed';
    case 'SUBMITTED':
      return 'submitted';
    case 'UNDER_REVIEW':
      return 'underReview';
    case 'REJECTED':
      return 'rejected';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    case 'EXPIRED':
      return 'expired';
    default:
      return 'pending';
  }
}
