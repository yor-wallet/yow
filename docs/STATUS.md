# DOOM | دوم — État réel du projet

> Rien n'est déclaré terminé sans implémentation **et** tests. Dernière mise à jour : voir l'historique Git.
> Légende : ✅ livré et testé · 🟡 partiel · ⛔ pas encore écrit.

## Vérifications (branche `claude/doom-ecommerce-platform-nmtfab`)

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` | propre |
| `npm test` (Vitest, base PostgreSQL de test) | tous verts : parité i18n ar/en/fr (40), 22 tests purs du catalogue, 17 tests d'intégration vitrine (listes, filtres, tri numérique, pagination par curseur, recherche arabe, favoris, panier, fusion de panier), 15 tests du socle (contraintes SQL, auth, idempotence…) |
| `npm run build` | réussi |
| `npm run test:e2e` | vitrine, panier, commande, commandes : exécutés sur iPhone SE, iPad mini et bureau (voir la CI pour les 10 formats) |

## Modules

### Socle — ✅
Design system (jetons, thèmes sombre/clair), i18n ar (RTL) / en / fr avec test de parité, authentification (sessions, bcrypt 12, limitation de débit), RBAC, journal d'audit, idempotence, chiffrement AES-256-GCM, stockage (local / Supabase), PWA, schéma Prisma (52 modèles, contraintes CHECK, grand livre à écritures doubles), graine sans produit ni prix.

### Vitrine — ✅ (sauf points ci-dessous)
- Accueil selon la spec : carrousel d'annonces (scènes 3D CSS téléphone / portable / écouteurs, lecture/pause, balayage, réduction de mouvement), promotions réelles, rayons produits avec états vides honnêtes, DOOM FLEX (illustration calculée, non contractuelle), DOOM EXPRESS, avis vérifiés, support.
- Catégories, liste d'une catégorie, recherche (arabe normalisé), filtres et tri dans l'URL, feuille de filtres mobile (brouillon + nombre de résultats en direct), « voir plus » par curseur.
- Fiche produit : galerie avec zoom, variantes, prix et stock réels, quantité, ajout au panier / achat immédiat, favoris, partage, livraison / garantie / FLEX, caractéristiques, avis vérifiés, données structurées schema.org sans fait inventé.
- Panier : lignes tarifées côté serveur, gestion des lignes indisponibles, fusion du panier visiteur à la connexion.
- Commande : adresse (ajout en feuille), type de livraison et frais réels de la zone, code promo, moyen de paiement, passage de commande idempotent avec réservation de stock 15 min, redirection vers la page de commande.
- Pages `/orders` (liste filtrable, recherche par numéro) et `/orders/[numéro]` (suivi, code de remise, articles, adresse, paiements, remboursements, historique, **payer / réessayer**, **annuler** une commande non payée).
- `/promotions`, `/favorites`, `/delivery` (chiffres lus dans la configuration des zones).
- ⛔ À faire : comparateur (`/compare` + bouton), dépôt d'avis, reçu PDF, produits associés.

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
- ⛔ Aucune page `/admin` : création de produits, prix/stock, campagnes, promotions, commandes, finance, support, logistique, validation des propositions des agents.
  Conséquence : **aucun produit ne peut encore être créé depuis l'interface** (la vitrine affiche donc des états vides tant que la base est vide).

## Points d'attention connus
- Dépendances : `npm audit` signale 6 avis (zod < 4.6.6, postcss via Next, `@prisma/config`). Les corrections demandent des montées de version majeures (zod 4, Prisma 7, Next 16) : à planifier et à tester, pas à forcer.
- Le composant `Logo` demande `quality=90` à `next/image` : à déclarer dans `images.qualities` avant Next 16.
- Passerelles à contrat (carte, Ooredoo, Omantel, cryptomonnaie, partenaire FLEX) : adaptateurs réels, inactifs sans configuration.
- Le code des routes liées par l'en-tête et le pied de page mais non écrites répond encore par la page 404 localisée (`/wallet`, `/flex`, `/account/*`, `/admin`).
