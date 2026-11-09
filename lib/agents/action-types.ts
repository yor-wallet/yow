import type { Permission } from '@/lib/rbac';

/**
 * Whitelist of actions an agent may PROPOSE. Each needs a human with the listed
 * permission (plus `agents:decide`) to apply it. Handlers live in lib/agents/actions.ts.
 */
export const ACTION_PERMISSIONS = {
  'variant.setPrice': 'prices:write',
  'product.disableSale': 'catalog:write',
  'campaign.deactivate': 'campaigns:write',
  'promotion.deactivate': 'promotions:write',
  'payment.flag': 'payments:write',
  'notification.send': 'notifications:send',
  'ticket.escalate': 'support:write',
  'reservations.releaseExpired': 'orders:write',
} as const satisfies Record<string, Permission>;

export type ActionType = keyof typeof ACTION_PERMISSIONS;

export const ACTION_TYPES = Object.keys(ACTION_PERMISSIONS) as ActionType[];

export function isActionType(v: unknown): v is ActionType {
  return typeof v === 'string' && v in ACTION_PERMISSIONS;
}
