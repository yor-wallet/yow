/** Display names of the gift-card brands (proper nouns: the same in every language). */
const LABELS: Record<string, string> = {
  APPLE: 'Apple',
  GOOGLE_PLAY: 'Google Play',
  PLAYSTATION: 'PlayStation',
  XBOX: 'Xbox',
  STEAM: 'Steam',
  NINTENDO: 'Nintendo',
  AMAZON: 'Amazon',
  NETFLIX: 'Netflix',
  RAZER_GOLD: 'Razer Gold',
};

/** `GOOGLE_PLAY` → `Google Play`; unknown or OTHER → `fallback`. */
export function giftCardBrandLabel(brand: string, fallback: string): string {
  return LABELS[brand] ?? fallback;
}
