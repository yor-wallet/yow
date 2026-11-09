/** Small helpers shared by agents (pure). */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function ago(now: Date, ms: number): Date {
  return new Date(now.getTime() - ms);
}

/** Start of the Asia/Muscat day containing `d` (UTC+4, no DST). */
export function muscatDayStart(d: Date): Date {
  const shifted = new Date(d.getTime() + 4 * HOUR);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 4 * HOUR);
}

/** Limit evidence lists stored in proposals. */
export function top<T>(items: readonly T[], n = 20): T[] {
  return items.slice(0, n);
}

/** Ratio in basis points (0 when denominator is 0). */
export function ratioBps(num: number, den: number): number {
  return den > 0 ? Math.round((num * 10_000) / den) : 0;
}

export function localizedMissing(value: unknown): string[] {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return (['ar', 'en', 'fr'] as const).filter((l) => typeof v[l] !== 'string' || !(v[l] as string).trim());
}

export function nameOf(value: unknown): string {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  for (const l of ['en', 'ar', 'fr']) if (typeof v[l] === 'string' && (v[l] as string).trim()) return v[l] as string;
  return typeof value === 'string' ? value : '';
}

/** Keyword categorisation for support tickets (deterministic). */
export const TICKET_CATEGORIES: Record<string, readonly string[]> = {
  payment: ['payment', 'paid', 'card', 'charge', 'pay', 'دفع', 'بطاقة', 'paiement', 'carte', 'wallet', 'محفظة', 'portefeuille', 'top-up', 'gift', 'هدية'],
  delivery: ['delivery', 'shipping', 'courier', 'late', 'track', 'توصيل', 'شحن', 'مندوب', 'livraison', 'livreur', 'retard', 'express'],
  refund: ['refund', 'return', 'استرجاع', 'استرداد', 'إرجاع', 'remboursement', 'retour'],
  product: ['broken', 'defect', 'warranty', 'damaged', 'ضمان', 'تالف', 'معطل', 'garantie', 'défectueux', 'cassé', 'product', 'منتج', 'produit'],
  account: ['account', 'login', 'password', 'حساب', 'كلمة المرور', 'compte', 'mot de passe', 'connexion'],
  kyc: ['kyc', 'verification', 'identity', 'id card', 'توثيق', 'هوية', 'تحقق', 'vérification', 'identité'],
  flex: ['flex', 'installment', 'instalment', 'تقسيط', 'قسط', 'versement', 'mensualité'],
};

export function categoriseText(text: string): string {
  const t = text.toLowerCase();
  let best = 'other';
  let bestScore = 0;
  for (const [cat, words] of Object.entries(TICKET_CATEGORIES)) {
    const score = words.reduce((s, w) => (t.includes(w.toLowerCase()) ? s + 1 : s), 0);
    if (score > bestScore) {
      best = cat;
      bestScore = score;
    }
  }
  return best;
}
