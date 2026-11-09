# DOOM | دوم — Architecture & conventions

Authoritative product rules: [`docs/SPEC.md`](./SPEC.md). This document is the **contract** between
modules. Read it before writing code; when you add a shared convention, add it here.

Stack: Next.js 15 App Router · React 19 · TypeScript (strict) · Tailwind v4 · next-intl 4 · motion 12 ·
Prisma 6 + PostgreSQL · zod 3 · bcryptjs · jose · Vitest · Playwright.

---

## 1. Directory layout

```
app/
  layout.tsx                 pass-through root layout (document lives in [locale]/layout.tsx)
  not-found.tsx              fallback 404 for non-localised URLs
  global-error.tsx           last-resort error boundary
  globals.css                design tokens (Tailwind v4 @theme) + base/stability CSS
  fonts.ts                   self-hosted Inter + IBM Plex Sans Arabic (next/font/local)
  manifest.ts                PWA manifest (/manifest.webmanifest)
  media/[...path]/route.ts   serves PUBLIC uploads of the local storage driver
  api/health/route.ts        liveness/readiness probe (DB check)
  [locale]/
    layout.tsx               <html lang dir data-theme>, providers, site chrome, metadata, viewport
    page.tsx                 placeholder home → storefront replaces it
    (auth)/login, register   auth pages + actions.ts (loginAction, registerAction, logoutAction)
    account/page.tsx         minimal account shell → logistics & account extends it
    legal/[slug]/page.tsx    terms | privacy | returns (copy in messages/*/legal.json)
    ui-kit/                  internal component gallery (404 in prod unless ENABLE_UI_KIT=1)
    not-found.tsx, error.tsx branded 404 / error with Back
    [...rest]/page.tsx       unknown localised paths → localised 404
components/
  ui/                        design-system primitives (see §8)
  layout/                    Header, MobileHeader, MobileBottomNav, Footer, PageHeader, BackButton…
i18n/                        routing.ts, navigation.ts, request.ts, namespaces.ts
lib/                         core server/client libraries (see §4)
messages/{ar,en,fr}/{ns}.json   translations split by namespace (see §3)
prisma/                      schema.prisma, migrations/, seed.ts, seed-data.ts
public/                      brand/, icons/ (generated from brand-src), sw.js, offline.html
storage/private/             private files of the local driver (gitignored)
tests/unit/**                Vitest
tests/e2e/**                 Playwright (helpers.ts: expectNoHorizontalOverflow, gotoReady, …)
middleware.ts                next-intl locale routing ONLY
```

Path alias: `@/*` → repo root (`import { prisma } from '@/lib/db'`).

## 2. Module ownership

Each module edits only its own paths. Shared files (schema, globals.css, layout, lib core, i18n
setup) belong to the foundation — if you must change one, keep the change minimal, additive and
documented here.

- **storefront**: `app/[locale]/(shop)/**` (home, category, product, search, cart, checkout, compare, favorites, promotions), `components/shop/**`, `components/ads/**`, `lib/catalog/**`, `lib/cart/**`, `lib/orders/**`
- **money**: `app/[locale]/wallet/**`, `app/[locale]/flex/**`, `app/api/payments/**`, `app/api/webhooks/**`, `lib/wallet/**`, `lib/payments/**`, `lib/flex/**`, `lib/receipts/**`, `components/wallet/**`
- **logistics & account**: `app/[locale]/account/**`, `app/[locale]/orders/**` (tracking), `lib/delivery/**`, `lib/kyc/**`, `components/account/**`, `components/delivery/**`
- **admin & agents**: `app/[locale]/admin/**`, `app/api/admin/**`, `app/api/cron/**`, `lib/agents/**`, `lib/admin/**`, `components/admin/**`, `scripts/run-agents.ts`

The home page `app/[locale]/page.tsx` belongs to **storefront** from now on (it may be moved into `(shop)`).

Message namespaces follow the same split: storefront → `home, catalog, product, cart, checkout`;
money → `wallet, payments, flex`; logistics & account → `account, kyc, delivery, orders`;
admin & agents → `admin, agents`. Foundation → `common, nav, auth, errors, legal`.

### Routes the chrome already links to (owners must create them)

| Route | Linked from | Owner |
|---|---|---|
| `/categories`, `/category/[slug]`, `/search?q=`, `/cart`, `/promotions` | header, mega-menu, bottom nav, footer, seed campaigns | storefront |
| `/wallet`, `/flex` | header, footer, seed campaign `doom-flex` | money |
| `/orders`, `/account/notifications`, `/account/support`, `/delivery` (DOOM EXPRESS info + zones; seed campaign `doom-express`) | bottom nav, header bell, footer | logistics & account |
| `/admin` | header (staff only), account page | admin & agents |

The admin area renders **without** storefront chrome (`components/layout/SiteChrome.tsx`,
`BARE_ROUTES`); build `app/[locale]/admin/layout.tsx` as its own shell.

## 3. Internationalisation (next-intl)

- Locales `ar` (default, RTL), `en`, `fr`; `localePrefix: 'always'`. `/` negotiates via
  `Accept-Language` + `NEXT_LOCALE` cookie and falls back to `ar`.
- Always import `Link`, `useRouter`, `usePathname`, `redirect`, `getPathname` from
  `@/i18n/navigation` and write paths **without** locale (`<Link href="/cart">`).
- Route params: `const locale = asLocale((await params).locale); setRequestLocale(locale);`
- Server components: `getTranslations('ns')` (async) or `useTranslations('ns')` (non-async).
  Client components: `useTranslations` — all messages are provided by `NextIntlClientProvider`.
- **Adding translations**: edit `messages/en/<ns>.json` **and** `ar` + `fr` with the same keys.
  Keys are type-checked from `en` (`global.d.ts`), and `tests/unit/i18n-parity.test.ts` fails on
  any missing/extra key, empty value, or mismatched ICU placeholder. Arabic must be real Arabic,
  French real French. Arabic plurals use `zero/one/two/few/many/other`.
- New namespace: add it to `i18n/namespaces.ts`, `global.d.ts`, and create the 3 JSON files.
- Validation errors are **codes** (`phone_invalid`) translated with
  `useValidationMessage()` → `messages/*/errors.json → validation`.
- Translatable DB content is Json `{ ar, en, fr }` (`LocalizedText`); read with
  `localize(value, locale)` from `lib/localized.ts`. Dates: `timeZone: 'Asia/Muscat'`, Latin digits
  (`format.dateTime(d, 'short' | 'long')`).

## 4. Core libraries (`lib/`)

| Module | Key exports |
|---|---|
| `db.ts` | `prisma`, `type Db` (client or tx), `serializable(fn, {maxRetries})` (SERIALIZABLE + retry on 40001/P2034), `isUniqueViolation(err, field?)` |
| `money.ts` | `formatBaisa(baisa, locale, {currency?, signed?, trimWhole?})`, `formatOmrNumber`, `parseOmrToBaisa(input, locale?) → number \| null`, `omrToBaisa`, `sumBaisa`, `applyBasisPoints(baisa, bps)`, `splitInstallments(total, n)` (last absorbs rounding), `currencyLabel`, `toLatinDigits` |
| `auth/index.ts` (server) | `register(input)`, `login(input)`, `logout()`, `getSession()`, `requireUser({next})`, `requireRole(roles, {next})`, `requirePermission(perm, {next})`, `requireApiUser()`, `requireApiPermission(perm)`, `createSession`, `destroySession`, `revokeAllSessions`, `hashPassword`, `verifyPassword` |
| `auth/service.ts` | `createUser`, `authenticate` (DB-only, rate limited: 5 failures/account, 20/IP per 15 min) |
| `auth/tokens.ts` | `signToken(payload, {purpose, expiresIn})`, `verifyToken(token, purpose)` (jose HS256 — signed links, not sessions) |
| `rbac.ts` | `PERMISSIONS`, `type Permission`, `ROLE_PERMISSIONS`, `can(role, perm)`, `canAll`, `isStaff`, `canAssignRole`, `STAFF_ROLES` |
| `audit.ts` | `logAudit({actorId, actorRole, action, entity, entityId, before, after, ip?, userAgent?}, db?)`, `redact(value)` |
| `idempotency.ts` | `withIdempotency({scope, key, userId, request}, fn) → {result, replayed}`, `IdempotencyError`, `stableStringify`, `purgeExpiredIdempotencyRecords` |
| `crypto.ts` | `encryptBuffer(buf, aad?) → {ciphertext, iv, authTag}`, `decryptBuffer`, `encryptString`/`decryptString` (`v1.iv.tag.ct`), `sha256Hex`, `fingerprint(value)` (keyed HMAC), `randomToken`, `randomNumericCode`, `timingSafeEqualString` |
| `storage.ts` | `getStorage(): StorageDriver` (`put/get/delete/exists/publicUrl`), buckets `'public' \| 'private'`, `buildKey(prefix, ext)`, `assertSafeKey`, `sniffMime(buf)`, `EXT_BY_MIME`, `MIME_BY_EXT`, `mediaUrl(key)` |
| `validation/index.ts` | `omanPhoneSchema` (→ `+968XXXXXXXX`), `normalizeOmanPhone`, `isOmanMobile`, `emailSchema`, `passwordSchema`, `fullNameSchema`, `localeSchema`, `baisaSchema`, `positiveBaisaSchema`, `idSchema`, `slugSchema`, `idempotencyKeySchema`, `omanCoordinatesSchema`, `paginationSchema`, `searchQuerySchema`, `safeRedirectPath`, `registerSchema`, `loginSchema`, `addressInputSchema`, `fieldErrorsOf`, `formDataToObject` |
| `http.ts` | `HttpError`, `json`, `jsonError`, `apiHandler(handler, {sameOrigin})`, `assertSameOrigin(req)`, `parseJson(req, schema)`, `requireIdempotencyKey(req)`, `toErrorResponse` |
| `rate-limit.ts` | `rateLimit(key, limit, windowMs)` (Postgres fixed window, atomic) |
| `request.ts` | `getRequestMeta() → {ip, userAgent}`, `ipFromHeaders` |
| `nav.ts` (server) | `getNavCategories()` (cached, tag `NAV_CATEGORIES_TAG`), `getHeaderCounts()` |
| `cookies.ts` | `SESSION_COOKIE='doom_session'`, `CART_COOKIE='doom_cart'`, `THEME_COOKIE='doom_theme'`, `LOCALE_COOKIE`, `secureCookies()` |
| `history.ts` (client) | `canGoBackInApp()`, `getHistoryIndex()`, `installHistoryTracking()` |
| `localized.ts` | `LocalizedText`, `localize`, `localizedTextSchema`, `isLocalizedText` |

`server-only` guards `lib/auth/*` and `lib/nav.ts`. Other `lib` modules are importable from
scripts (`tsx`) — e.g. `scripts/run-agents.ts` may import `lib/db`, `lib/audit`, `lib/money`.

**Catching errors around `cookies()`/`headers()`**: always call `unstable_rethrow(err)` (from
`next/navigation`) first in the `catch`, otherwise Next.js cannot mark the route dynamic.

## 5. Conventions

### Money
- Always an **integer number of baisa** (`Int` in Prisma, `number` in TS). Column names end with
  `Baisa` (`priceBaisa`, `totalBaisa`, `amountBaisa`). Never floats, never `Decimal`.
- Display with `<Price baisa={…} />` or `formatBaisa` (Latin digits, 3 decimals, `OMR` / `ر.ع.`).
- `priceBaisa === null` ⇒ “price unavailable”, not sellable. **Never invent prices or stock.**
- Percentages are basis points (`Promotion.value` for `PERCENT`: 100 = 1%).

### Server actions vs API routes
- **Server actions** for first-party UI mutations (forms, buttons). Next.js already enforces an
  Origin check on actions. Validate with zod; return `{ status, fieldErrors }` shaped state
  (see `app/[locale]/(auth)/actions.ts`); `redirect()` from `@/i18n/navigation` after success.
- **API routes** (`app/api/**`) for webhooks, cron, downloads, client fetches. Wrap with
  `apiHandler(..., { sameOrigin: true })` for cookie-authenticated mutations; webhooks must NOT
  use the origin check — verify the provider signature and store the raw event in
  `PaymentProviderEvent` (unique `provider + eventId` ⇒ replay-safe).
- Cron routes (`/api/cron/*`) authenticate with `Authorization: Bearer ${CRON_SECRET}`.

### Idempotency
- Every order/payment/top-up/refund/instalment mutation takes a client idempotency key
  (`crypto.randomUUID()` generated when the page loads, reused on retries/back/double-click).
- Wrap with `withIdempotency({ scope: 'order.create', key, userId, request }, fn)`.
- Money tables carry their own unique keys as a DB backstop: `Order.idempotencyKey`,
  `PaymentIntent.idempotencyKey`, `LedgerTransaction.idempotencyKey`, `Refund.idempotencyKey`.
- Payment state is always re-read from the server; Back never re-triggers a payment.

### Ledger (money module)
- Double entry: a `LedgerTransaction` has ≥ 2 `LedgerEntry` rows whose `amountBaisa` **sum to 0**
  — enforced at COMMIT by a deferred constraint trigger; entries are append-only (corrections =
  reversal transactions, `reversesId`).
- `LedgerAccount.balanceBaisa` is a cache of `SUM(entries)` updated in the same transaction
  (lock the row: `SELECT … FOR UPDATE` or use `serializable()`); CUSTOMER_WALLET balances can
  never go negative (CHECK). Recommended sign convention: `balance = SUM(amountBaisa)`, a
  customer wallet's positive balance is spendable money (credit wallet = positive entry).
- System accounts (seeded, `code` = type): PLATFORM_CASH, PAYMENT_CLEARING, PLATFORM_REVENUE,
  DELIVERY_REVENUE, GIFT_CARD_CLEARING, REFUNDS, FLEX_RECEIVABLE, DISCOUNTS, ADJUSTMENTS.
  Wallet accounts: `code = "WALLET:<userId>"`, created lazily with the `Wallet` row.
- Credit a wallet only after real confirmation (verified webhook or admin-verified encashed value).

### Audit & RBAC
- Check permissions, not roles: `requirePermission('catalog:write')` in pages/actions,
  `requireApiPermission(...)` in route handlers, `can(role, perm)` for conditional UI.
  Add new permissions to `lib/rbac.ts` (and the roles that need them).
- Every sensitive change calls `logAudit(...)` **inside the same transaction** (`db` = tx). Secrets
  are redacted automatically. KYC document access additionally writes `KycAccessLog`.

### Security
- Sessions: random 32-byte token in httpOnly `SameSite=Lax` cookie `doom_session` (Secure in
  production), only `sha256(token)` stored in `Session`. 30-day expiry.
- Passwords: bcrypt cost 12. Login rate limited per account and per IP (`LoginAttempt`).
- KYC files / gift-card codes: encrypt with `lib/crypto` (AES-256-GCM, `KYC_ENCRYPTION_KEY`), store
  ciphertext in the **private** bucket, keep `iv`, `authTag`, `sha256` in the row. Use the record id
  as AAD. Never serve private files without a permission check + access log.
- Uploads: never trust the client MIME — `sniffMime(buffer)`; SVG uploads are not served.
- Security headers (CSP, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy with camera &
  geolocation = self, HSTS, COOP) are in `next.config.ts`. A payment provider needing redirects,
  iframes or form posts to its domain must be added to `form-action` / `frame-src` / `connect-src`
  there, explicitly.
- Per-IP limits trust `x-forwarded-for` (set by Vercel). Self-hosted deployments must put a proxy
  in front that overwrites it.

### Storage
`getStorage().put('private', buildKey('kyc/<userId>', 'bin'), encrypted.ciphertext)`.
Local driver: public → `public/uploads/<key>` served at `/media/<key>`; private → `storage/private`.
Production on Vercel needs `STORAGE_DRIVER=supabase` (implemented) or an S3 driver implementing the
same `StorageDriver` interface (register it in `getStorage()`).

### Data & seed
- Schema covers all modules; append fields only if unavoidable and create a new migration
  (`npx prisma migrate dev --name <change>`), then `DATABASE_URL=…/doom_test npx prisma migrate deploy`.
- The init migration contains hand-written CHECK constraints (prices ≥ 0, stock ≥ 0,
  reserved ≤ stock, rating 1–5, FLEX months ∈ {3,6,12}, …) and the ledger triggers.
- Seed (`npm run db:seed`, idempotent): categories, brands, 11 governorates / 61 wilayas, one
  delivery zone per governorate with **NULL fees** (unconfigured ⇒ delivery type unavailable),
  ledger system accounts, campaign copy (no prices), superadmin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
- Anonymous cart: cookie `doom_cart` = random token; `Cart.anonTokenHash = sha256Hex(token)`.
  The header cart count (`getHeaderCounts`) relies on this contract.
- Campaign `linkUrl` is a locale-less internal path; campaigns without media render as typographic
  gradient banners using `theme` (`primary | secondary | premium`).

## 6. Navigation, Back & history-backed overlays

- **PageHeader** on every secondary page, as a direct child of the page's top-level element:
  `<PageHeader title={t('title')} fallbackHref="/account" />` — sticky glass bar with back arrow
  (mirrored in RTL) on < lg, inline title + text back button on lg+. `mobileOnly` renders just the bar.
- **BackButton / useSafeBack(fallbackHref)**: `router.back()` only when the previous history
  entry belongs to this site, else `router.replace(fallbackHref)` — never loops, never leaves the
  site. Tracking: `lib/history.ts` wraps `pushState/replaceState` so every entry carries
  `history.state.__doomIdx` (mirrored to `sessionStorage['doom:nav-depth']`); it survives reloads.
  BackButton renders a real link to the fallback, so it works before hydration.
- **Modals & sheets**: `const m = useHistoryModal('id'); <Modal {...m.props} title=…>`.
  `open()` pushes a history entry; browser/Android/iOS Back closes the overlay first; `close()`
  pops the entry; `closeThen(() => router.push(…))` for navigation from inside an overlay.
  Dialogs trap focus, close on Escape/overlay click, lock scroll, never exceed `100dvh`, and keep
  focused inputs visible above the keyboard.
- Filters live in URL search params; non-sensitive drafts in `sessionStorage`.

## 7. Design tokens (`app/globals.css`)

The default Tailwind palette is **removed** — only these exist:

Palette utilities (`bg-*`, `text-*`, `border-*`, …):

| Token | Hex | Token | Hex |
|---|---|---|---|
| `night` | #10052E | `white` | #FFFFFF |
| `night-2` | #190B45 | `mist` (secondary text on dark) | #C9C5DE |
| `blue` | #087BFF | `snow` (light bg) | #F7F9FF |
| `cyan` | #00D9FF | `ink` (light text) | #17152D |
| `orange` | #FF7900 | `success` | #16A673 |
| `amber` | #FFAE00 | `error` | #E5484D |

Semantic, theme-aware tokens — prefer these in components:

| Token | Use |
|---|---|
| `bg-bg`, `bg-bg-2` | page backgrounds |
| `bg-surface`, `bg-surface-2` | cards, inputs, hover states |
| `text-fg`, `text-muted` | primary / secondary text (AA in both themes) |
| `border-border`, `border-border-strong` | borders |
| `text-accent` | links & accent text (AA-safe in light theme) |
| `text-on-accent` | ink (#10052E) on gradients and solid success/error/amber |
| `ring` / `outline-ring` | focus ring |

- Gradients: `bg-gradient-primary` (blue→cyan), `bg-gradient-secondary` (orange→amber),
  `bg-gradient-premium` (night→night-2→blue); `text-gradient-*` for large display text on dark only.
- Effects: `shadow-glow-blue|cyan|orange`, `shadow-card`, `shadow-float`, `glass`,
  `gradient-border`, `gradient-border-secondary`, `rounded-card` (1.25rem), `rounded-pill`.
- Layout: `page-container` (max 1600px, fluid gutter ≥ 16px + safe areas), `pb-safe`, `pt-safe`,
  `tap-target` (44px), `scrollbar-none`, `flip-rtl` (mirror directional icons), `skeleton`.
- Breakpoints: `xs` 375 · `sm` 430 · `md` 768 · `lg` 1024 (desktop chrome) · `xl` 1280 · `2xl` 1600.
- Motion: `duration-(--dur-btn)` 140ms · `duration-(--dur-nav)` 240ms · `duration-(--dur-card)`
  280ms · `duration-(--dur-banner)` 600ms; easings `ease-premium`, `ease-snappy`; animations
  `animate-fade-in|slide-up|sheet-in|modal-in|toast-in|shimmer`. `prefers-reduced-motion` reduces
  every animation/transition globally; `<Reveal>` renders statically for reduced motion.
- Theme: dark default; light via `<html data-theme="light">` from the `doom_theme` cookie (server
  rendered ⇒ no flash). Any subtree can force a theme with `data-theme="dark"` (the footer and
  premium banners do). Variants `dark:` / `light:` follow `data-theme`.
- Stability: `html{overflow-x:clip}`, `body{min-height:100dvh}`, media `max-width:100%`, inputs
  ≥ 16px, safe-area vars `--safe-*`, viewport `viewport-fit=cover`, `interactive-widget=resizes-content`,
  zoom never disabled. Use `grid-cols-1` (not an implicit track) on mobile grids so long content
  cannot widen the page; mark intentional horizontal scrollers with `data-scroll-x`.
- Logo: only `<Logo />` (official assets; `surface` auto/dark/light; fixed width/height). Never
  recolour or redraw. Transparent variants on dark surfaces only; light surfaces use the plate variant.

## 8. UI components (`components/ui`, `components/layout`)

`Button` (`variant: primary | accent | secondary | outline | ghost | danger`, `size: sm | md | lg | icon`,
`loading`, `fullWidth`, `leadingIcon`, `trailingIcon`) · `buttonClasses(...)` for links ·
`SubmitButton` (pending from `useFormStatus`) · `Input`, `PasswordInput`, `Select`, `Textarea`,
`Checkbox` (`label`, `hint`, `error`) · `Card` (`tone: surface | glass | gradient | premium`,
`interactive`) · `Badge`, `CountBubble` · `Price` (`baisa`, `compareAtBaisa`, `size`, `showSavings`) ·
`Skeleton`, `SkeletonText` · `ToastProvider` + `useToast().toast({title, description, variant})` ·
`EmptyState` · `Modal`, `BottomSheet`, `useHistoryModal` · `Tabs` (`items`, `value`, `onChange`,
`label`) · `Stepper` (`steps`, `current`) · `Spinner` · `Reveal` (`delay`, `y`) · `Logo` ·
`CategoryIcon` (`name` = `Category.icon`) · `useValidationMessage()`.

Layout: `Header` (async; desktop header + `MobileHeader`), `MegaMenu`, `SearchBox`
(→ `/{locale}/search?q=`), `MobileBottomNav` (Home · Categories · Cart · Orders · Profile),
`Footer`, `PageHeader`, `BackButton`, `useSafeBack`, `ThemeProvider`/`useTheme`, `ThemeToggle`,
`LocaleSwitcher` (`menu | sheet | inline`), `SiteChrome`, `NavigationTracker`, `ServiceWorkerRegister`.

Accessibility: ≥ 44px targets, visible focus ring, labels/`aria-describedby` on fields, live
regions for toasts, `aria-current` on nav, skip link, `lang`/`dir` on `<html>`.

## 9. PWA

`app/manifest.ts` (name `DOOM | دوم`, start `/ar`, standalone, theme/background #10052E, maskable
icons). `public/sw.js`: precaches `/offline.html` + brand assets, cache-first for `/_next/static`,
fonts, `/brand`, `/icons`; never intercepts non-GET, `/api`, `/media`, payments, checkout, wallet,
admin or HTML pages (offline page shown when a navigation fails). Bump `VERSION` to invalidate.

## 10. Environment & commands

`.env.example` documents every variable (DATABASE_URL, TEST_DATABASE_URL, APP_URL, SESSION_SECRET,
KYC_ENCRYPTION_KEY, ADMIN_EMAIL/PASSWORD, CRON_SECRET, storage, payment providers — empty ⇒ provider
shown as unavailable).

```
npm run dev | build | start
npm run typecheck                    # tsc --noEmit
npm test                             # vitest (uses TEST_DATABASE_URL → doom_test)
npm run test:e2e                     # playwright, 10 device projects (Chromium)
npx playwright test --project=iphone-se --project=ipad-mini --project=desktop
E2E_SKIP_BUILD=1 npx playwright test # reuse the current .next build
npm run db:migrate | db:migrate:dev | db:seed
```

Playwright's web server migrates + seeds `doom_test`, builds, and starts with `ENABLE_UI_KIT=1`.
E2E helpers: `expectNoHorizontalOverflow(page)`, `gotoReady(page, url)` (waits for
`html[data-hydrated]`), `uniqueUser(testInfo)`, `useUniqueIp(page)`, `backButton(page)`.
