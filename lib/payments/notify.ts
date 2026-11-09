import { createTranslator } from 'next-intl';
import { prisma, type Db } from '@/lib/db';
import { formatBaisa } from '@/lib/money';
import type { LocalizedText } from '@/lib/localized';
import { notify } from '@/lib/notifications';
import arPayments from '@/messages/ar/payments.json';
import enPayments from '@/messages/en/payments.json';
import frPayments from '@/messages/fr/payments.json';

/**
 * Money-module notifications (wallet credit, gift card decision, refund, FLEX…). Copy lives
 * in `messages/{locale}/payments.json → notifications.<key>.{title,body}`; amounts are
 * passed in baisa (`amountBaisa`) and formatted per locale.
 */

export type MoneyNotificationKey = keyof typeof enPayments.notifications;

const MESSAGES = { ar: arPayments, en: enPayments, fr: frPayments } as const;
type L = keyof typeof MESSAGES;
const LOCALES: L[] = ['ar', 'en', 'fr'];

type Loose = (key: string, values?: Record<string, string | number>) => string;
const make = createTranslator as unknown as (o: { locale: string; messages: Record<string, unknown>; namespace: string }) => Loose;
const cache = new Map<L, Loose>();
function tr(l: L): Loose {
  let t = cache.get(l);
  if (!t) {
    t = make({ locale: l, messages: { payments: MESSAGES[l] }, namespace: 'payments.notifications' });
    cache.set(l, t);
  }
  return t;
}

export function renderMoneyNotification(
  key: MoneyNotificationKey,
  params: Record<string, string | number> & { amountBaisa?: number } = {},
): { title: LocalizedText; body: LocalizedText } {
  const title = {} as LocalizedText;
  const body = {} as LocalizedText;
  for (const l of LOCALES) {
    const { amountBaisa, ...rest } = params;
    const values = { ...rest, ...(typeof amountBaisa === 'number' ? { amount: formatBaisa(amountBaisa, l) } : {}) };
    title[l] = tr(l)(`${key}.title`, values);
    body[l] = tr(l)(`${key}.body`, values);
  }
  return { title, body };
}

/** Best-effort in-app notification (never breaks the money flow). */
export async function notifyMoney(
  userId: string,
  key: MoneyNotificationKey,
  params: Record<string, string | number> & { amountBaisa?: number },
  link: string,
  db: Db = prisma,
): Promise<void> {
  try {
    const { title, body } = renderMoneyNotification(key, params);
    await notify({ userId, type: `money.${key}`, title, body, link }, db);
  } catch (err) {
    console.error('[payments] notification failed', key, err);
  }
}
