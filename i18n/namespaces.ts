/**
 * Message namespaces. One JSON file per namespace per locale:
 * `messages/{ar,en,fr}/{namespace}.json`. Each module owns its namespace(s),
 * so parallel work never edits the same file.
 */
export const NAMESPACES = [
  'common',
  'nav',
  'auth',
  'home',
  'catalog',
  'product',
  'cart',
  'checkout',
  'orders',
  'wallet',
  'payments',
  'flex',
  'delivery',
  'account',
  'kyc',
  'admin',
  'agents',
  'errors',
  'legal',
] as const;

export type Namespace = (typeof NAMESPACES)[number];
