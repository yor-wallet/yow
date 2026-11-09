import { useTranslations } from 'next-intl';
import type { KycStatus, OrderStatus, ShipmentStatus, TicketStatus } from '@prisma/client';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';

const ORDER_VARIANT: Record<OrderStatus, BadgeVariant> = {
  PENDING_PAYMENT: 'warning',
  PAID: 'info',
  PROCESSING: 'info',
  PACKED: 'info',
  SHIPPED: 'primary',
  OUT_FOR_DELIVERY: 'primary',
  DELIVERED: 'success',
  CANCELLED: 'neutral',
  REFUNDED: 'neutral',
  PARTIALLY_REFUNDED: 'neutral',
};

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const t = useTranslations('orders.status');
  return (
    <Badge variant={ORDER_VARIANT[status]} className={className} data-status={status}>
      {t(status)}
    </Badge>
  );
}

const SHIPMENT_VARIANT: Record<ShipmentStatus, BadgeVariant> = {
  CONFIRMED: 'info',
  PREPARING: 'info',
  PACKED: 'info',
  COURIER_ASSIGNED: 'primary',
  OUT_FOR_DELIVERY: 'secondary',
  DELIVERED: 'success',
  FAILED: 'error',
};

export function ShipmentStatusBadge({ status, className }: { status: ShipmentStatus; className?: string }) {
  const t = useTranslations('delivery.status');
  return (
    <Badge variant={SHIPMENT_VARIANT[status]} className={className} data-status={status}>
      {t(status)}
    </Badge>
  );
}

export const KYC_BADGE: Record<KycStatus, BadgeVariant> = {
  UNVERIFIED: 'neutral',
  PENDING: 'info',
  DOCUMENTS_REQUESTED: 'warning',
  VERIFIED: 'success',
  REJECTED: 'error',
};

export function KycStatusBadge({ status, className }: { status: KycStatus; className?: string }) {
  const t = useTranslations('kyc.status');
  return (
    <Badge variant={KYC_BADGE[status]} className={className} data-testid="kyc-status-badge" data-status={status}>
      {t(status)}
    </Badge>
  );
}

const TICKET_VARIANT: Record<TicketStatus, BadgeVariant> = {
  OPEN: 'info',
  IN_PROGRESS: 'primary',
  WAITING_CUSTOMER: 'warning',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

export function TicketStatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  const t = useTranslations('account.support.status');
  return (
    <Badge variant={TICKET_VARIANT[status]} className={className} data-status={status}>
      {t(status)}
    </Badge>
  );
}
