# DOOM | دوم — État réel du projet

> Rien n'est déclaré terminé sans implémentation **et** tests. Dernière mise à jour : voir l'historique Git.
> Légende : ✅ livré et testé · 🟡 partiel · ⛔ pas encore écrit.

## Vérifications (branche `claude/doom-ecommerce-platform-nmtfab`)

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` | propre |
| `npm test` (Vitest, base PostgreSQL de test) | 283 tests au dernier passage ; 224 tests verts, dont : 6 tests de l'import de visuels, 6 tests de l'import de catalogue, 5 tests de modération des avis, 5 tests des zones et tarifs, 6 tests des livreurs et de la préparation des commandes, 5 tests du dépôt d'avis, 5 tests du comparateur, 5 tests des zones de livraison (rien n'est promis sans configuration), parité i18n ar/en/fr (40), 22 tests purs du catalogue, 17 tests d'intégration vitrine (listes, filtres, tri numérique, pagination par curseur, recherche arabe, favoris, panier, fusion de panier), 15 tests du socle (contraintes SQL, auth, idempotence…), 15 tests des mutations du catalogue admin, 4 tests de lecture des formulaires admin, 4 tests du tableau de bord et des commandes admin, 8 tests « chaque page admin se protège elle-même » |
| `npm run build` | réussi |
| `npm run test:e2e` | vitrine, panier, commande, commandes **et administration** (création d'un produit → variante avec prix/stock → image → publication → visible en boutique ; erreurs de formulaire ; commandes ; contrôle d'accès ; arabe RTL) : 151 tests verts (2 ignorés par conception) sur iPhone SE, iPad mini et bureau (voir la CI pour les 10 formats) |

## Modules

### Socle — ✅
Design system (jetons, thèmes sombre/clair), i18n ar (RTL) / en / fr avec test de parité, authentification (sessions, bcrypt 12, limitation de débit), RBAC, journal d'audit, idempotence, chiffrement AES-256-GCM, stockage (local / Supabase), PWA, schéma Prisma (52 modèles, contraintes CHECK, grand livre à écritures doubles), graine sans produit ni prix.

### Vitrine — ✅ (sauf points ci-dessous)
- **Refonte téléphone selon la maquette validée** (thème clair par défaut, sombre au choix) : bandeau violet fixe avec logo centré, flèche retour dans le bandeau sur les pages secondaires, titres centrés, zone de livraison choisie par l'acheteur (témoin `doom_area`), recherche à bouton bleu, bannière compacte, pastilles de délais **lues dans les zones configurées** (rien n'est affiché sans configuration), 4 tuiles de catégories, cartes produit claires, barre d'onglets Accueil · Catégories · Favoris · Panier · Compte.
- **Fiche produit (téléphone)** : pastilles de couleur, menu de capacité, « Détails » repliable, aperçu des mensualités FLEX 3/6/12 mois calculé sur le prix réel (illustration non contractuelle), ligne de livraison de la zone, bouton orange épinglé. Bureau : puces, quantité et achat immédiat conservés.
- **Panier** : mode de livraison chiffré par le même moteur que la commande (colis réel, frais et capacité de la zone), moyens de paiement réellement disponibles (icônes neutres, « indisponible » sinon), récapitulatif ; le choix de livraison est transmis à la commande dans l'URL et recalculé sur l'adresse.
- Police arabe d'affichage Alexandria (auto-hébergée) pour titres et prix, corps en IBM Plex Sans Arabic ; transition de page en fondu ; inclinaison 3D des cartes au survol (pointeur fin uniquement) ; tout respecte la réduction de mouvement.
- Accueil selon la spec : carrousel d'annonces (scènes 3D CSS téléphone / portable / écouteurs, lecture/pause, balayage, réduction de mouvement), promotions réelles, rayons produits avec états vides honnêtes, DOOM FLEX (illustration calculée, non contractuelle), DOOM EXPRESS, avis vérifiés, support.
- Catégories, liste d'une catégorie, recherche (arabe normalisé), filtres et tri dans l'URL, feuille de filtres mobile (brouillon + nombre de résultats en direct), « voir plus » par curseur.
- Fiche produit : galerie avec zoom, variantes, prix et stock réels, quantité, ajout au panier / achat immédiat, favoris, partage, livraison / garantie / FLEX, caractéristiques, avis vérifiés, données structurées schema.org sans fait inventé.
- Panier : lignes tarifées côté serveur, gestion des lignes indisponibles, fusion du panier visiteur à la connexion.
- Commande : adresse (ajout en feuille), type de livraison et frais réels de la zone, code promo, moyen de paiement, passage de commande idempotent avec réservation de stock 15 min, redirection vers la page de commande.
- Pages `/orders` (liste filtrable, recherche par numéro) et `/orders/[numéro]` (suivi, code de remise, articles, adresse, paiements, remboursements, historique, **payer / réessayer**, **annuler** une commande non payée).
- `/promotions`, `/favorites`, `/delivery` (chiffres lus dans la configuration des zones).
- Comparateur `/compare` (jusqu'à 4 produits, bouton sur la fiche produit, valeurs absentes signalées et jamais inventées), **dépôt d'avis** réservé aux acheteurs livrés (un avis par article, enregistré « en attente » : rien n'est publié automatiquement), **produits associés** (même catégorie, puis catégorie parente).
- Retour de navigation : barre de progression en haut de page, apparition échelonnée des grilles. Aucun fichier `loading` sur les fiches produit, catégories et panier : le flux transformerait les 404 en 200 et laisserait cliquer avant que la page soit interactive.
- Les avis déposés sont publiés ou refusés depuis l'administration (`/admin/reviews`).

### Paiements — 🟡
- ✅ Bibliothèques : registre des moyens, adaptateurs (carte, Ooredoo, Omantel, crypto : « indisponible » tant que non configurés), cartes cadeaux, webhooks, notifications.
- ✅ Dans la vitrine : paiement par portefeuille (écriture comptable atomique), moyens indisponibles affichés avec leur raison.
- ⛔ Pages `/wallet` (solde, recharge, historique, reçus PDF) et routes `/api/payments`, `/api/webhooks` ; formulaires de cartes cadeaux.

### DOOM FLEX — ⛔
Modèles de données et prévisions de paiement (3/6/12 mois, dernière échéance absorbant les baisas) existent ; ni logique de demande / décision / échéancier, ni pages `/flex`.

### Compte, livraison, KYC — 🟡
- ✅ Bibliothèques (adresses, devis de livraison, expéditions, preuve de remise, code à usage unique, KYC chiffré, support, notifications) et composants de suivi.
- ✅ Pages : connexion, inscription, compte (minimal), commandes, livraison.
- ⛔ Pages `/account/addresses`, `/account/notifications`, `/account/support`, `/account/profile`, `/account/security`, `/account/help`, `/account/verification` (KYC), espace livreur.

### Administration et agents — 🟡
- ✅ Cadre de mutations (RBAC + validation + transaction + audit), paramètres, moteur de prix, médias, 15 agents à périmètre limité, exécution par cron.
- ✅ Centre d'administration `/admin` (accès réservé au personnel : visiteur → connexion, client → 404, chaque page se protège elle-même avec `requireAdmin`) : coque (barre latérale / feuille mobile, arabe RTL), **vue d'ensemble** (chiffres réels : chiffre d'affaires encaissé 30 jours net des remboursements partiels, commandes, impayés, produits, stock faible / rupture), **produits** (liste filtrable dans l'URL, création, édition, caractéristiques, variantes avec prix et stock réels, images optimisées, publication / brouillon / archivage — un produit ne se publie qu'avec au moins une variante active), **commandes** (liste, recherche, détail en lecture : client, articles, totaux, paiements, remboursements, historique).
- ✅ **Avis** (`/admin/reviews` : file d'attente, publier / refuser / retirer, audit), **zones et tarifs** (`/admin/logistics/zones` : frais, délais, capacités ; l'express exige frais standard, supplément et capacité), **livreurs** (`/admin/logistics/couriers` : création, compte relié, activation), **préparation et livraison** sur la fiche commande (préparer → emballer → attribuer un livreur, échec et relance ; la remise au client reste faite par le livreur avec le code du client).
- ✅ **Import de catalogue** (`/admin/products/import`) : charge un fichier JSON de modèles **en brouillon uniquement**. Aucune variante, aucun prix, aucun stock, aucune photo n'est créé ; les couleurs et capacités du fichier sont gardées comme « candidats à vérifier » (notes réservées à l'administration, colonne `Product.importMeta`, migration `20261112090000_product_import_meta` réversible). Réimporter ne crée pas de doublon et n'écrase pas les modifications. Le pack 2026 (48 modèles candidats, non vérifiés) est dans `data/catalogue/doom-pack-catalogue-2026.json` ; il n'est importé dans aucune base par le code.
- ✅ **Pack de visuels iPhone** (bouton sur `/admin/products/import`, données dans `data/catalogue/iphone-visuals-2026`) : 26 modèles (iPhone 13 à 18, SE, Air, Duo), 111 photos studio. L'import crée, modèle par modèle avec barre de progression, un brouillon avec une variante par finition × capacité (364 au total) et une photo par finition (WebP + AVIF) ; **aucun prix ni stock n'est défini, rien n'est publié**. Relancer l'import n'ajoute rien et ne touche jamais un prix ou un stock saisi. Les finitions et capacités sont celles du pack (vérifiées par son auteur, pas par nous) ; les droits d'utilisation des photos relèvent du propriétaire.
- ✅ **Pack de photos du propriétaire** (second bouton sur `/admin/products/import`, données dans `data/catalogue/doom-photos-2026-11`, originaux dans `originals/`) : 11 photos fournies le 13/11/2026, recadrées sur fond blanc sans retouche, pour 10 modèles — Apple Watch Series 11 (argent, noir de jais), Apple Watch Ultra, AirPods Pro 3, iPad Air, iPad mini, HUAWEI Pura 70, HUAWEI Pura 90s Pro Max, Galaxy Z Fold8 Ultra, HONOR Magic8 Pro (Sunrise Gold, même fiche que le catalogue vérifié), JBL Boombox 4. Chaque modèle devient un brouillon **sans variante, sans prix ni stock**, avec ses photos ; un encadré « Points à vérifier avant publication » reprend les doutes (noms tirés des fichiers, générations non indiquées, photo des AirPods qui ressemble aux Pro 2, Fold qui ressemble au Fold6). Rayons ajoutés : **Tablettes › iPad** et **Montres connectées › Apple Watch** (créés à l'import si la base est plus ancienne). Écartées : 3 photos d'iPhone déjà couvertes par les photos officielles Apple, 2 rendus portant le filigrane GSMArena (liste dans `catalogue.json`, champ `excluded`).
- **Marque (identité de novembre 2026, cahier des charges du propriétaire)** : logo jaune et marine au sac, palette `#FEE225` / `#0A1937` / `#FDFAF6`, IBM Plex Sans + IBM Plex Sans Arabic, en-tête clair sur téléphone et PC, boutons principaux jaunes, effets néon retirés. Détail dans `docs/IDENTITY.md`. Les logos précédents restent dans l'historique Git. Moteur de nettoyage serveur livré (désactivé par défaut, voir `docs/MAINTENANCE.md`). Reste à faire du cahier : `<bdi>` systématique, liste vérifiée des boutons, mesures de performance.
- ⛔ Pas encore d'écrans pour : catégories, marques, promotions, remboursements, finance (portefeuilles, grand livre, paiements, cartes cadeaux, FLEX), clients, KYC, support, incidents de livraison, réglages du site, journal d'audit. Ces entrées restent masquées du menu tant qu'elles n'existent pas. (Campagnes, agents IA et propositions : livrés.)

### Catalogue 2026 — ✅ (faits vérifiés) · ⛔ (prix, stocks, photos)
Détail et liste des modèles : [docs/CATALOGUE_2026.md](CATALOGUE_2026.md).
- 46 modèles sur 48 vérifiés sur les pages officielles Apple / Samsung / HONOR / OPPO ; 420 variantes réelles (Apple, Samsung) créées **sans prix ni stock** ; HONOR et OPPO en brouillon (combinaisons à confirmer) ; 2 modèles OPPO à vérifier.
- Boutique : filtres série et année, catégorie OPPO, caractéristiques officielles en 3 langues, **plus aucune illustration dessinée** : la boutique n'affiche que les vraies photos (carte sans photo = pictogramme neutre, fiche = « Photos bientôt disponibles »), « prix bientôt disponible ».
- Administration : grille prix/coût/stock par produit, export/import CSV avec simulation, compteurs « sans prix / sans photo », bouton « Appliquer le catalogue vérifié ».
- ⛔ À saisir par l'équipe : prix, stocks, photos officielles, garanties, disponibilité locale.

## Points d'attention connus
- Dépendances : `npm audit` signale 6 avis (zod < 4.6.6, postcss via Next, `@prisma/config`). Les corrections demandent des montées de version majeures (zod 4, Prisma 7, Next 16) : à planifier et à tester, pas à forcer.
- Le composant `Logo` demande `quality=90` à `next/image` : à déclarer dans `images.qualities` avant Next 16.
- Passerelles à contrat (carte, Ooredoo, Omantel, cryptomonnaie, partenaire FLEX) : adaptateurs réels, inactifs sans configuration.
- Le code des routes liées par l'en-tête et le pied de page mais non écrites répond encore par la page 404 localisée (`/wallet`, `/flex`, `/account/*`).
- Les images envoyées par l'administration passent par une action serveur (limite 12 Mo dans `next.config.ts`) ; sur un hébergement qui plafonne le corps des requêtes plus bas (ex. 4,5 Mo), prévoir un envoi direct vers le stockage.

### Photos produits sur la boutique (14 novembre 2026)
- Les photos du propriétaire sont appliquées par **`npm run catalogue:photos`** (`-- --publish` publie les modèles vendus tels quels : AirPods Pro 2 / Pro 3 / Max, Watch Ultra 2, JBL Boombox 4 — sans prix ni stock, donc « prix bientôt disponible »). `scripts/vercel-build.sh` l'enchaîne avec `RUN_CATALOGUE_IMPORT=1` (jamais bloquant). Le pack du propriétaire compte maintenant 14 modèles / 15 photos (ajouts : Galaxy S25 Ultra, AirPods Max, AirPods Pro 2, Watch Ultra 2). L'enceinte Sony verte est gardée de côté (modèle exact non précisé).
- À l'accueil comme en liste, à pertinence égale les produits avec photo passent en premier.
- Les dessins `DeviceArt` ne sont plus appelés par la carte, la galerie ni la fiche (`components/devices/*` et `lib/devices/art.ts` restent dans le dépôt, inutilisés).
- **Photos livrées avec le site (sans clé de stockage)** : `public/photos/` (6,7 Mo, généré par `npm run catalogue:photos:build` à partir des packs) est servi par le site lui-même ; clé d'image `bundled/<pack>/<modèle>/<finition>.webp` (`lib/bundled-photo.ts`, `mediaUrl`). `npm run catalogue:photos -- --bundled` écrit seulement les lignes en base (aucun envoi) ; `scripts/vercel-build.sh` l'utilise avec `RUN_CATALOGUE_IMPORT=1`. Les photos ajoutées depuis l'administration restent dans le stockage Supabase (clé `SUPABASE_SERVICE_ROLE_KEY` nécessaire pour celles-là).
