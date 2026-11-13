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

Vitrine complète (accueil, catégories, recherche, fiche produit, panier, commande, commandes, favoris, comparateur, avis, produits associés), refonte téléphone selon la maquette du propriétaire, identité jaune/marine (novembre 2026), portefeuille / paiements / FLEX / compte / KYC / espace livreur (autre session), administration (produits, commandes avec préparation et livreurs, avis, zones et tarifs, campagnes, agents IA, **import de catalogue** : catalogue vérifié, pack de visuels iPhone, pack de photos du propriétaire, import CSV prix/stock). Tous les imports créent des **brouillons sans prix ni stock**.

## 6. Reste à faire

**Cahier des charges du propriétaire** (`DOOM_Design_Implementation_AR.md`, remis en novembre 2026) :
1. §1–§2 faits (palette, IBM Plex, logo, en-tête clair, mouvements). Reste : isoler avec `<bdi>` les noms d'appareils dans les phrases arabes restantes (prix via `Price`, noms dans cartes / panier / comparateur faits), vérifier les titres longs et le zoom de texte sur téléphone.
2. §3 : **recherche avec suggestions faite** (`components/layout/SearchBox.tsx`, `app/api/catalog/suggest`, attente 250 ms, requête annulée si le texte change, clavier, tests e2e). Reste : tiroirs du menu et du panier rapide (ouverture depuis le début du sens de lecture), fenêtres modales (titre, « Fermer », retour du focus).
3. §4 performances : champs minimaux par carte, pagination en lots, fractionnement des bundles, images responsives, mesures **LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,10** avant/après.
4. §5 moteur de nettoyage serveur : **fait** (`lib/maintenance/cleanup.ts`, `docs/MAINTENANCE.md`) — désactivé par défaut (`cleanup.enabled`), aperçu par `npm run maintenance:cleanup`. Reste : l'écran d'administration des réglages pour modifier les durées sans SQL.
5. §6 **audit des boutons** : **fait pour le nom, la cible et la taille** — `scripts/audit-controls.mjs` (parcours de 132 pages × 15 138 contrôles : 0 sans nom, 0 lien mort ou cassé, cibles ≥ 44 px sauf exceptions WCAG 2.5.8 documentées) et garde-fou `tests/e2e/controls.spec.ts` (30 tests). Reste : vérifier à la main le résultat de chaque action (succès / échec / chargement) sur les pages connectées et les formulaires.
6. §7 livrables : palette et police (fait : `docs/IDENTITY.md`), liste des boutons vérifiés, résultat de l'aperçu du nettoyage, mesures avant/après.

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

Ce fichier ne contient aucun souvenir personnel du propriétaire : seulement ce qui sert à reprendre ce chantier.
