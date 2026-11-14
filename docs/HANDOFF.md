# DOOM | دوم — passation (reprise du travail par un autre compte / une autre session)

> Dernière mise à jour : 13 novembre 2026. À lire avant toute intervention, puis `docs/STATUS.md` (état réel module par module) et `docs/IDENTITY.md` (identité visuelle).
> Aucun secret dans ce fichier. Le `.env` local (base de test) est ignoré par Git : ne jamais le committer ni l'afficher.

## 1. Où est le travail

- Dépôt : **`yor-wallet/yow`**, branche **`claude/doom-ecommerce-platform-nmtfab`** (tout est poussé, arbre propre).
- Clone local utilisé jusqu'ici : `/home/user/yow` (à recloner si l'environnement est neuf).
- **Deux sessions poussent sur cette branche** (session « Doom ecommerce platform » et une session « Opus 5.5 » qui a fait le catalogue vérifié, l'import des prix, les photos du propriétaire et le déploiement). Avant chaque push : `git fetch` puis `git rebase origin/claude/doom-ecommerce-platform-nmtfab`, petits commits. Les conflits déjà rencontrés : `ProductHero.tsx`, page d'import admin, `messages/*/admin.json`, `docs/STATUS.md`.
- Pas de pull request tant que le propriétaire n'en demande pas. Pas de déploiement ni d'écriture en production sans accord.

## 2. Le propriétaire et ses règles

- Parle **français** (depuis un iPhone) ; répondre en français, concis, sans jargon. Il veut un site « stable, fluide, agréable », sans faute d'orthographe, sans nom inventé, « pas de travail à la va-vite », **dans l'ordre**, sans étape sautée. Il demande d'avancer sans s'arrêter (« Continue ») mais d'être honnête sur ce qui est vérifié.
- Règles DOOM (cf. `docs/SPEC.md`) : montants en baisa entiers (OMR, 3 décimales) ; **jamais de faux prix, stock, avis, réduction ni badge** ; un paiement n'est « confirmé » que s'il est réellement reçu ; prestataires non configurés affichés « indisponibles » ; bouton Retour sur toute page secondaire ; filtres dans l'URL ; idempotence sur les mutations d'argent ; audit des changements sensibles ; délais de livraison promis = capacités configurées ; chiffres FLEX illustratifs.
- **Logo** : uniquement via `<Logo />` et le pipeline `scripts/generate-icons.mjs` (recadrage et détourage, jamais redessiné ni recoloré).
- Décisions du propriétaire : logo jaune et marine au sac (remplace les logos précédents) ; « A » coloré = simple inspiration ; visuel d'appareils sur fond violet = décor ; thème clair par défaut.
- Le dépôt `Bank-muscat` (autre projet) a ses propres règles (`CLAUDE.md`) : ne pas y toucher depuis ce chantier. **Point en suspens** : une branche `claude/doom-ecommerce-platform-nmtfab` a été créée par erreur dans `yor-wallet/Bank-muscat`, avec 3 commits Bank Muscat 24.5.1 légitimes (`af14459`, `3f3bd0f`, `3dd22dd`) ; la branche prévue pour ce dépôt est `claude/quirky-pascal-vzegch`. Proposer le déplacement au propriétaire, ne rien réécrire sans son accord.

## 3. Lancer et vérifier (procédure éprouvée)

```bash
cd /home/user/yow
service postgresql start            # la base locale s'arrête à chaque redémarrage du conteneur
export TEST_DATABASE_URL="$(grep '^TEST_DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')"
npx tsc --noEmit -p .               # typage
npm test                            # Vitest (base doom_test) — jamais en même temps qu'un e2e
DATABASE_URL="$TEST_DATABASE_URL" ENABLE_UI_KIT=1 NEXT_TELEMETRY_DISABLED=1 npm run build
(DATABASE_URL="$TEST_DATABASE_URL" ENABLE_UI_KIT=1 NEXT_TELEMETRY_DISABLED=1 nohup npx next start -p 3000 > /tmp/server.log 2>&1 &)
curl http://localhost:3000/api/health
npx playwright test --project=iphone-se --project=ipad-mini --project=desktop --trace off
```

- Avant les tests : `pkill -f next-server; pkill -f "next start"; pkill -f "next dev"` (un vieux serveur sur le port 3000 sert silencieusement un ancien build).
- Sans `TEST_DATABASE_URL` exporté, Playwright échoue (P1000).
- Dernier état vérifié : typage propre, **274 tests unitaires** et **151 tests de bout en bout** verts (iPhone SE, iPad mini, bureau ; 2 ignorés par conception) avant les deux derniers commits de l'autre session (photos, `<bdi>`), qui ont leurs propres tests.
- Visuel : `next dev -p 3100` avec la base `doom`, captures Playwright (390×844 pour le téléphone). Penser à `rm -rf .next/cache/images` après un changement de fichiers de marque.
- Migrations : `npx prisma migrate deploy` sur les deux bases (`DATABASE_URL` et `TEST_DATABASE_URL`) après chaque récupération de commits contenant `prisma/migrations/*`, puis `npx prisma generate`.
- Messages : toute chaîne vit dans `messages/{ar,en,fr}/*.json` ; `tests/unit/i18n-parity.test.ts` exige les mêmes clés et les mêmes variables ICU dans les 3 langues (arabe : pluriels complets).

## 4. Pièges connus

- **Pas de fichier `loading.tsx`** sur les pages produit, catégorie et panier : le flux transformerait leur 404 en 200 et laisserait cliquer avant l'hydratation.
- Playwright : un seul élément visible par `data-testid="add-to-cart"` / `product-title` ; le bouton retour se cherche avec `[data-testid="back-button"]:visible`. Sur téléphone, la quantité se règle dans le panier (la fiche produit n'a qu'un bouton orange épinglé) ; sur bureau, sélecteur de quantité et « acheter maintenant ».
- Une capacité se choisit par menu natif sous `lg` (`pickCapacity` dans `tests/e2e/helpers.ts`), par boutons au-dessus.
- Cache de l'application : changer `VERSION` dans `public/sw.js` à chaque livraison de marque ou de styles (actuellement `doom-v3`).
- Le logo clair n'a pas de plaque ; sur surface sombre, `Logo surface="dark"` ajoute la plaque blanc cassé.
- Ne pas lancer `tests/e2e/global-setup` à la main (laisse des zones de test et casse `db.test.ts`).

## 5. Ce qui est livré (résumé ; détail dans `docs/STATUS.md`)

Vitrine complète (accueil, catégories, recherche, fiche produit, panier, commande, commandes, favoris, comparateur, avis, produits associés), refonte téléphone selon la maquette du propriétaire, identité jaune/marine (novembre 2026), portefeuille / paiements / FLEX / compte / KYC / espace livreur (autre session), administration (produits, commandes avec préparation et livreurs, avis, zones et tarifs, campagnes, agents IA, **import de catalogue** : catalogue vérifié, pack de visuels iPhone, pack de photos du propriétaire, import CSV prix/stock). Tous les imports créent des **brouillons sans prix ni stock**. Les photos s'appliquent avec `npm run catalogue:photos` (aucun dessin d'illustration n'est affiché : le propriétaire n'en veut pas).

## 5 bis. Mise en production du 14/11/2026 (session « Opus 5.5 », sur ordre du propriétaire)

- **Déploiement** : les déploiements Git échouent (`git_info_fail` / limite de l'API GitHub chez Vercel). Contournement utilisé : déploiement par fichiers (`package.json` + `vercel.json` dont `installCommand` télécharge l'archive du commit sur `codeload.github.com` puis `npm ci`). Déployé : `f9f95be` (`dpl_D5AvRTin7yo2XGAYz4mpcmfRovLn`), avec `RUN_SEED=1 RUN_CATALOGUE_IMPORT=1` dans la commande de construction de ce seul déploiement (variables du projet inchangées, toujours à `0`).
- **Production** : migration `20261113180000_neighborhoods` appliquée ; 35 rayons (dont Tablettes et Montres connectées) ; 91 quartiers ; photos importées (126) ; compte du propriétaire promu `SUPERADMIN` à sa demande (procédure de `docs/DEPLOYMENT.md`).
- **Prix** (ordre du propriétaire : prix du marché − 10 %) : `data/catalogue/market-prices-2026-11.json` (iSTYLE Oman, revendeur agréé Apple, relevé le 14/11/2026) appliqué aux variantes sans prix : 202 variantes, 20 produits (iPhone, AirPods Pro 3 / Pro 2, Apple Watch Ultra 2), une ligne d'audit par produit (`catalogue.prices.market`). Stock non touché : tout reste « épuisé » tant que le stock n'est pas saisi. Commande pour un autre environnement : `npm run catalogue:prices`.
- **Stock** (ordre du propriétaire : « 600 pièces de chaque type ») : 600 unités sur les 510 variantes de production, un mouvement `RECEIPT` et une ligne d'audit `stock.adjust` par variante.
- **Bloquant pour vendre** : frais de livraison non configurés (toutes les zones à NULL) et aucun moyen de paiement configuré (carte, Ooredoo, Omantel : clés du prestataire à saisir) ; à demander au propriétaire, ne rien inventer.
- **Mise en ligne n° 2 (14/11/2026, session « Doom ecommerce platform », sur ordre du propriétaire)** : `36d6b69` (réglages de paiement : crypto, cartes cadeaux avec commission 8 %, plafonds du portefeuille, écran `/admin/site/settings`) déployé par fichiers, même contournement (`dpl_HnCeZbdMsy6ppbW73PWdC66aCK5R`, alias `doom-yordigitalefinance.vercel.app`). `RUN_SEED` et `RUN_CATALOGUE_IMPORT` laissés à `0` : **aucune écriture en base**, aucune migration nouvelle. Vérifié en ligne : santé, routes protégées (307 vers la connexion, pas 404), photos toujours affichées, aucune erreur d'exécution. Effet côté clients : les cartes cadeaux vérifiées à partir de maintenant sont créditées moins 8 % ; la crypto reste indisponible (aucun prestataire, `crypto.enabled` éteint). Les déploiements Git échouent toujours (limite de l'API GitHub : « API rate limit exceeded for user » chez Vercel).
- **Mise en ligne n° 3 (14/11/2026, sur ordre du propriétaire : « Mise en ligne »)** : `b8870b5` (paiement en USDT direct vers les adresses du propriétaire, vérifié sur la blockchain) déployé par fichiers (`dpl_5Ck8hHCo8M5Bd7rrvZ7p6tGEMHK1`), `RUN_SEED=0 RUN_CATALOGUE_IMPORT=0` forcés dans la commande de construction : **aucune écriture en base**. Variables de production ajoutées (adresses **publiques** données par le propriétaire, sommes de contrôle vérifiées) : `CRYPTO_ADDRESS_TRON`, `CRYPTO_ADDRESS_BSC`, `CRYPTO_ADDRESS_ETH`. Le réglage `crypto.enabled` reste **éteint** : le propriétaire l'active lui-même (Administration › Réglages › Paiements) après un test réel à petit montant. Vérifié en ligne : santé, routes protégées (307), `/api/webhooks/crypto` → 404, pied de page « Crypto (USDT) », aucune erreur d'exécution. Non vérifié : un vrai paiement (à faire par le propriétaire) ; `CRYPTO_TRONGRID_KEY` pas encore créée (conseillée).
- **Paiements crypto activés (14/11/2026, ordre du propriétaire : « Active les paiement crypto »)** : réglage `crypto.enabled` = 1 écrit en production (table `Setting`, une ligne de journal d'audit `settings.payments.update`, entité `Setting/crypto`). Seul changement : `crypto.requireKyc` reste à sa valeur par défaut (**oui**) ; à ce moment, 0 compte client vérifié en production, donc personne ne peut encore payer en crypto tant que le propriétaire ne décide pas (vérification d'identité des clients, ou réglage éteint).
- **Mise en ligne n° 4 (14/11/2026, sur ordre du propriétaire)** : `bc7529c` (confirmation du compte par e-mail, vérification d'identité par l'administrateur avec e-mails) déployé par fichiers (`dpl_6iUvuYxGDwCUYZYLW8EtLG8jr4uD`), aucune écriture en base. Variable ajoutée : `MAIL_FROM` (seul expéditeur vérifié du compte Brevo du propriétaire). **Manquent toujours** (secrets que seul le propriétaire peut coller) : `BREVO_API_KEY` (sans elle aucun e-mail ne part et la confirmation n'est pas exigée) et `SUPABASE_SERVICE_ROLE_KEY` (sans elle les clients ne peuvent pas envoyer leurs pièces d'identité). Vérifié en ligne : santé, `/admin/kyc` et `/account/verification` protégés (307), `/verify-email` répond, aucune erreur.
- **Mise en ligne n° 5 (14/11/2026, clés données par le propriétaire dans la conversation, « fait le toi-même »)** : `7ca8e53` (stockage : la nouvelle clé secrète Supabase `sb_secret_…` part dans l'en-tête `apikey` seulement, comme Supabase l'exige ; un refus de Supabase n'est plus pris pour « fichier absent ») déployé par fichiers (`dpl_4WXG5nZXb9VVBaN1hUZD7mxzJywK`, en construction à l'écriture de ces lignes), aucune écriture en base. Variable ajoutée : `SUPABASE_SERVICE_ROLE_KEY` (*sensitive*, production) → les clients peuvent envoyer leurs pièces d'identité (bucket privé `private`, chiffrées AES-256-GCM avant l'envoi). Vérifié avec la vraie clé sur le vrai projet : envoi, relecture identique, liste, suppression (fichier d'essai effacé) ; un lien public vers le bucket privé est refusé (400) ; aucune règle d'accès sur `storage.objects` (seule la clé serveur y accède).
- **E-mails : toujours éteints en ligne.** La clé Brevo donnée par le propriétaire n'entre pas dans la mise en ligne n° 5 ; elle est enregistrée dans Vercel (`BREVO_API_KEY`, *sensitive*, production) une fois ce déploiement prêt, car Brevo refuse tout appel venant d'une adresse IP inconnue (« Authorised IPs » actif : `401 unrecognised IP address`) et Vercel n'a pas d'adresse IP fixe. Avec la clé active, la confirmation d'e-mail deviendrait obligatoire alors qu'aucun e-mail ne peut partir (vérification d'identité bloquée pour tous). **Ne pas redéployer** (tout nouveau déploiement embarque la clé) avant que le propriétaire ait désactivé ce blocage (Brevo → Sécurité → Adresses IP autorisées) ; ensuite redéployer et vérifier un envoi réel. Les deux clés ont été collées dans la conversation : conseiller au propriétaire de les remplacer un jour (nouvelle clé, puis mise à jour de la variable).
- **Non fait** : prix Samsung / HONOR / OPPO / HUAWEI / JBL (Sharaf DG, Extra et Lulu bloquent la lecture automatique ; les comparateurs se contredisent), matrices HONOR / OPPO, variantes des nouveaux appareils (montres, iPad, Pura, Fold), erreur d'hydratation React #418 intermittente vue en ligne avant ce déploiement (non reproduite ensuite).

## 6. Reste à faire

**Cahier des charges du propriétaire** (`DOOM_Design_Implementation_AR.md`, remis en novembre 2026) :
1. §1–§2 faits (palette, IBM Plex, logo, en-tête clair, mouvements). Reste : isoler avec `<bdi>` les noms d'appareils dans les phrases arabes restantes (prix via `Price`, noms dans cartes / panier / comparateur faits), vérifier les titres longs et le zoom de texte sur téléphone.
2. §3 **fait** : recherche avec suggestions (`SearchBox.tsx`, `app/api/catalog/suggest`), **tiroir du panier rapide** sur PC (`components/layout/QuickCart.tsx`, `components/ui/Drawer.tsx`, `app/api/cart/quick`), fenêtres modales conformes (titre, « Fermer », focus piégé et rendu). Le « menu » est l'onglet Catégories de la barre du bas sur téléphone et le méga-menu sur PC (pas de menu hamburger).
3. §4 : mesures de laboratoire faites (`docs/PERFORMANCE.md`, `scripts/measure-vitals.mjs`) : LCP et CLS sous les cibles ; INP 256 ms sur l'accueil téléphone ralenti. Reste : optimisations de bundles / champs minimaux seulement si de vraies données le justifient.
4. §5 moteur de nettoyage : **fait** (autre compte, `docs/MAINTENANCE.md`) ; reste l'écran d'administration de ses réglages.
5. §6 **audit des boutons** : **fait pour le nom, la cible et la taille** — `scripts/audit-controls.mjs` (parcours de 132 pages × 15 138 contrôles : 0 sans nom, 0 lien mort ou cassé, cibles ≥ 44 px sauf exceptions WCAG 2.5.8 documentées) et garde-fou `tests/e2e/controls.spec.ts` (30 tests). Reste : vérifier à la main le résultat de chaque action (succès / échec / chargement) sur les pages connectées et les formulaires.
6. §7 livrables : palette et police (`docs/IDENTITY.md`), audit des boutons (`scripts/audit-controls.mjs`), mesures (`docs/PERFORMANCE.md`) faits ; reste l'aperçu du nettoyage (`npm run maintenance:cleanup` sur la base réelle).

**Administration** : écrans manquants — catégories, marques, promotions, remboursements, finance (portefeuilles, grand livre, paiements, cartes cadeaux, FLEX), clients, KYC, support, incidents de livraison, réglages du site, journal d'audit. Les entrées restent masquées du menu tant que l'écran n'existe pas (`BUILT_NAV_KEYS` dans `lib/admin/nav.ts`).

**Catalogue** : prix, stocks et photos par variante à saisir par le personnel (export/import CSV disponible) ; HONOR / OPPO : matrices couleur × capacité non confirmées (brouillons) ; droits d'usage des photos Apple/Samsung à confirmer par le propriétaire.

**Questions ouvertes au propriétaire** : garder ou supprimer le thème sombre (le cahier ne décrit que le clair) ; bannière d'accueil encore à l'ancien style (recolorée seulement) ; variables Figma non créées (code seulement) ; déplacement des 3 commits de la branche Bank-muscat.

## 7. Où trouver quoi

| Sujet | Fichiers |
|---|---|
| Jetons de couleur, durées, courbes | `app/globals.css` (jetons `--doom-*`, noms historiques `blue/cyan/orange/amber` → rôles de la palette) |
| Polices | `app/fonts.ts`, `app/[locale]/layout.tsx` |
| Marque | `brand-src/doom-logo-official.png`, `scripts/generate-icons.mjs`, `components/ui/Logo.tsx`, `docs/IDENTITY.md` |
| En-tête / navigation téléphone | `components/layout/MobileHeader.tsx`, `MobileHeaderStart.tsx`, `back-target.tsx`, `PageHeader.tsx`, `MobileBottomNav.tsx` |
| Fiche produit / panier | `components/shop/ProductHero.tsx`, `CartCheckout.tsx`, `lib/cart/preview.ts` |
| Livraison par zone | `lib/delivery/area.ts`, `quote.ts`, `lib/admin/zones.ts` |
| Imports de catalogue | `lib/admin/catalogue-verified.ts`, `catalogue-import.ts`, `visual-pack-import.ts`, `variant-pricing.ts`, `data/catalogue/*`, page `app/[locale]/admin/products/import` |
| Admin (cadre de mutations) | `lib/admin/mutation.ts`, `action.ts`, `guard.ts`, `components/admin/*` |
| Tests | `tests/unit/*`, `tests/e2e/*` (helpers dans `tests/e2e/helpers.ts`) |
| Déploiement | `docs/DEPLOYMENT.md`, `scripts/vercel-build.sh`, `scripts/predeploy-check.ts` |
| Paiements, crypto, cartes cadeaux, commission, plafonds | `docs/PAYMENTS.md`, `lib/payments/*`, `lib/admin/payment-settings.ts`, `/admin/site/settings` |
| Confirmation du compte par e-mail, vérification d'identité par l'administrateur | `docs/KYC.md`, `lib/email/*`, `lib/auth/email-verification.ts`, `lib/kyc/*`, `/admin/kyc` |

Ce fichier ne contient aucun souvenir personnel du propriétaire : seulement ce qui sert à reprendre ce chantier.
