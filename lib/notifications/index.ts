import { createTranslator } from 'next-intl';
import { prisma, type Db } from '../db';
import type { LocalizedText } from '../localized';
import arAccount from '../../messages/ar/account.json';
import enAccount from '../../messages/en/account.json';
import frAccount from '../../messages/fr/account.json';

/**
 * In-app notifications (`Notification` model). Titles/bodies are stored as
 * LocalizedText `{ ar, en, fr }` so the centre renders in the reader's language.
 * Templates live in `messages/{locale}/account.json → notificationTemplates`.
 *
 *   await notifyTemplate(userId, 'deliveryOutForDelivery', { number }, `/orders/${number}`, tx);
 */

export type NotificationTemplateKey = keyof typeof enAccount.notificationTemplates;

const ACCOUNT_MESSAGES = { ar: arAccount, en: enAccount, fr: frAccount } as const;
type Locale3 = keyof typeof ACCOUNT_MESSAGES;
const LOCALES: Locale3[] = ['ar', 'en', 'fr'];

type LooseTranslator = (key: string, values?: Record<string, string | number>) => string;
const makeTranslator = createTranslator as unknown as (opts: {
  locale: string;
  messages: Record<string, unknown>;
  namespace: string;
}) => LooseTranslator;

const translators = new Map<Locale3, LooseTranslator>();
function translator(locale: Locale3): LooseTranslator {
  let t = translators.get(locale);
  if (!t) {
    t = makeTranslator({ locale, messages: { account: ACCOUNT_MESSAGES[locale] }, namespace: 'account.notificationTemplates' });
    translators.set(locale, t);
  }
  return t;
}

/** Build the localized title/body of a template in the 3 languages. */
export function renderTemplate(
  key: NotificationTemplateKey,
  params: Record<string, string | number> = {},
): { title: LocalizedText; body: LocalizedText } {
  const title = {} as LocalizedText;
  const body = {} as LocalizedText;
  for (const l of LOCALES) {
    const t = translator(l);
    title[l] = t(`${key}.title`, params);
    body[l] = t(`${key}.body`, params);
  }
  return { title, body };
}

export type NotifyInput = {
  userId: string;
  /** Dotted type, e.g. `delivery.status`, `kyc.decision`, `support.reply`. */
  type: string;
  title: LocalizedText;
  body?: LocalizedText | null;
  /** Locale-less internal path (`/orders/DM-…`). */
  link?: string | null;
};

export async function notify(input: NotifyInput, db: Db = prisma) {
  return db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      ...(input.body ? { body: input.body } : {}),
      link: input.link ?? null,
    },
  });
}

/** Template keys → notification `type`. */
const TEMPLATE_TYPES: Record<NotificationTemplateKey, string> = {
  deliveryConfirmed: 'delivery.status',
  deliveryShipped: 'delivery.status',
  deliveryOutForDelivery: 'delivery.otp',
  deliveryOtpRenewed: 'delivery.otp',
  deliveryDelivered: 'delivery.status',
  deliveryFailed: 'delivery.status',
  kycSubmitted: 'kyc.status',
  kycVerified: 'kyc.decision',
  kycRejected: 'kyc.decision',
  kycDocumentsRequested: 'kyc.decision',
  supportCreated: 'support.ticket',
  supportReply: 'support.reply',
  passwordChanged: 'security.password',
  deletionRequested: 'security.deletion',
};

export async function notifyTemplate(
  userId: string,
  key: NotificationTemplateKey,
  params: Record<string, string | number>,
  link: string | null,
  db: Db = prisma,
) {
  const { title, body } = renderTemplate(key, params);
  return notify({ userId, type: TEMPLATE_TYPES[key], title, body, link }, db);
}

export async function unreadCount(userId: string, db: Db = prisma): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

export type NotificationFilter = 'all' | 'unread';

export async function listNotifications(userId: string, opts: { filter?: NotificationFilter; cursor?: string; take?: number } = {}) {
  const take = Math.min(Math.max(opts.take ?? 30, 1), 100);
  const rows = await prisma.notification.findMany({
    where: { userId, ...(opts.filter === 'unread' ? { readAt: null } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

/** Mark the given notifications (or all) of `userId` as read. Returns the number updated. */
export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return count;
}
