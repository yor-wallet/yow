/**
 * Type-safe translations: keys are typed from the ENGLISH message files.
 * Add a key to messages/en/<ns>.json (and ar/fr — the parity test enforces it)
 * and `t('key')` type-checks.
 */
import type { locales } from './i18n/routing';
import type common from './messages/en/common.json';
import type nav from './messages/en/nav.json';
import type auth from './messages/en/auth.json';
import type home from './messages/en/home.json';
import type catalog from './messages/en/catalog.json';
import type product from './messages/en/product.json';
import type cart from './messages/en/cart.json';
import type checkout from './messages/en/checkout.json';
import type orders from './messages/en/orders.json';
import type wallet from './messages/en/wallet.json';
import type payments from './messages/en/payments.json';
import type flex from './messages/en/flex.json';
import type delivery from './messages/en/delivery.json';
import type account from './messages/en/account.json';
import type kyc from './messages/en/kyc.json';
import type admin from './messages/en/admin.json';
import type agents from './messages/en/agents.json';
import type errors from './messages/en/errors.json';
import type legal from './messages/en/legal.json';

type AppMessages = {
  common: typeof common;
  nav: typeof nav;
  auth: typeof auth;
  home: typeof home;
  catalog: typeof catalog;
  product: typeof product;
  cart: typeof cart;
  checkout: typeof checkout;
  orders: typeof orders;
  wallet: typeof wallet;
  payments: typeof payments;
  flex: typeof flex;
  delivery: typeof delivery;
  account: typeof account;
  kyc: typeof kyc;
  admin: typeof admin;
  agents: typeof agents;
  errors: typeof errors;
  legal: typeof legal;
};

declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof locales)[number];
    Messages: AppMessages;
  }
}
