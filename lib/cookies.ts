/** Cookie names shared by every module. Do not invent new names for the same purpose. */
export const SESSION_COOKIE = 'doom_session';
/** Anonymous cart token (random). DB stores `Cart.anonTokenHash = sha256Hex(token)`. */
export const CART_COOKIE = 'doom_cart';
/** `dark` | `light`. Read on the server to render `<html data-theme>` with no flash. */
export const THEME_COOKIE = 'doom_theme';
/** Managed by next-intl middleware. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Whether auth cookies get the `Secure` flag. */
export function secureCookies(): boolean {
  if (process.env.SESSION_COOKIE_SECURE === 'false') return false;
  if (process.env.SESSION_COOKIE_SECURE === 'true') return true;
  return process.env.NODE_ENV === 'production';
}
