# DOOM | دوم — Guide de déploiement

Cible recommandée : **Vercel** (application Next.js) + **Supabase** (PostgreSQL managé + stockage
privé). Toute plateforme Node 20+ avec PostgreSQL 15+ convient également.

## 1. Base de données (Supabase ou PostgreSQL managé)
1. Créer un projet Supabase, région la plus proche d'Oman (ex. `me-central-1` / Bahreïn si disponible).
2. Récupérer :
   - l'URL **poolée** (port 6543, `?pgbouncer=true&connection_limit=1`) → `DATABASE_URL` ;
   - l'URL **directe** (port 5432) pour les migrations → `DIRECT_URL`. Activer `directUrl` dans
     `prisma/schema.prisma` si vous utilisez le pooler.
3. Appliquer les migrations et le seed (catégories, marques, gouvernorats/wilayas, comptes du grand
   livre, zones de livraison **sans tarifs**, campagnes de service, super-admin) :
   ```bash
   DATABASE_URL=<url directe> npx prisma migrate deploy
   DATABASE_URL=<url directe> ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run db:seed
   ```
4. Sauvegardes : activer les sauvegardes quotidiennes + PITR (Point-in-Time Recovery). Tester une
   restauration avant l'ouverture.

## 2. Stockage
- `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Bucket **public** (images produits, médias publicitaires) et bucket **privé** (documents KYC
  chiffrés, preuves de livraison). Le bucket privé ne doit avoir **aucune** politique de lecture
  publique : l'accès passe uniquement par les routes serveur autorisées et journalisées.
- Le disque local de Vercel est éphémère : le driver `local` est réservé au développement.

## 3. Variables d'environnement (Vercel → Settings → Environment Variables)
Voir `.env.example` pour la liste complète. Indispensables en production :

| Variable | Rôle |
|---|---|
| `DATABASE_URL` (+ `DIRECT_URL`) | PostgreSQL |
| `APP_URL` | URL publique, ex. `https://doom.om` |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `KYC_ENCRYPTION_KEY` | `openssl rand -base64 32` — **à sauvegarder hors ligne** ; sa perte rend les documents illisibles |
| `CRON_SECRET` | protège `/api/cron/*` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | uniquement pour le seed initial |
| Fournisseurs de paiement | laisser vides tant que les contrats ne sont pas signés → affichés « indisponibles » |
| `CRYPTO_ADDRESS_TRON`, `CRYPTO_ADDRESS_BSC`, `CRYPTO_ADDRESS_ETH` | adresses **publiques** de réception USDT du propriétaire (jamais de clé privée) ; somme de contrôle vérifiée, adresse fausse = réseau ignoré. Voir `docs/PAYMENTS.md` |
| `CRYPTO_TRONGRID_KEY` | clé gratuite TronGrid (conseillée : sans elle, limitation de débit) |

## 4. Vercel
1. Importer le dépôt GitHub `yor-wallet/yow`, framework **Next.js**.
2. Build command : `npm run build` (inclut `prisma generate`). Node 20+.
3. Région des fonctions : la plus proche de la base de données.
4. Domaine : ajouter le domaine `.om`, HTTPS automatique, rediriger `www` → apex.
5. Tâches planifiées : `vercel.json` déclare les crons (agents IA, libération des réservations de
   stock expirées). Vercel envoie automatiquement `Authorization: Bearer $CRON_SECRET`.

## 5. Webhooks des fournisseurs de paiement
À déclarer chez chaque prestataire une fois le contrat signé (détails dans `docs/PAYMENTS.md`) :
`https://<domaine>/api/webhooks/<fournisseur>`. Chaque événement est stocké brut, puis le statut
est **re-vérifié auprès de l'API du prestataire** avant tout crédit : un webhook seul ne confirme
jamais un paiement.

## 6. Mise en production — checklist
- [ ] `npm run typecheck`, `npm test`, `npm run test:e2e` verts (CI GitHub Actions).
- [ ] Migrations appliquées, seed exécuté, mot de passe super-admin changé après la première connexion.
- [ ] Zones de livraison : tarifs standard/express, capacité et heure limite renseignés par l'admin.
- [ ] Produits : prix et stocks réels saisis par l'admin (aucun prix n'est pré-rempli).
- [ ] TVA : paramètre `tax.vat` vérifié avec le comptable.
- [ ] Pages légales (`/legal/*`) relues par un juriste (modèles fournis).
- [ ] Portefeuille : validation réglementaire (Banque centrale d'Oman) avant d'accepter des recharges.
- [ ] Monitoring : Vercel Analytics / Speed Insights, alertes sur `/api/health`, journaux d'erreurs.
- [ ] Sauvegarde hors ligne de `KYC_ENCRYPTION_KEY` et `SESSION_SECRET`.
- [ ] Lighthouse mobile sur l'accueil et une fiche produit (objectifs : perf 90+, a11y 95+).

## 7. Exploitation
- **Agents IA** : `npm run agents:run` (manuel) ou cron ; propositions à valider dans
  *Admin → Agents*. Aucun agent ne modifie directement les données commerciales.
- **Rapprochement financier** : *Admin → Finance → Rapprochement* (grand livre ↔ paiements).
- **Journal d'audit** : *Admin → Audit* — toutes les modifications sensibles y sont tracées.
- **Rotation de la clé KYC** : voir `docs/KYC_PRIVACY.md`.

## 8. Application mobile
Voir `docs/ANDROID.md` (Capacitor Android/iOS et PWA).

## 9. Première mise en ligne — ce qui est en place

> ⚠️ Le compte Vercel `yordigitalefinance` contient déjà un projet **`yor-wallet`** et le compte Supabase un projet **`yor-wallet`** (l'ancien prototype, `legacy/`). **Ne pas les réutiliser** : DOOM a ses propres projets `doom` sur Vercel et sur Supabase.

**Build** — commande de build du projet Vercel : `npm run build:vercel` (`scripts/vercel-build.sh`). Elle est idempotente :
1. `prisma migrate deploy` sur `DIRECT_URL` (connexion en mode session ; l'URL poolée ne peut pas migrer) ;
2. si `RUN_SEED=1` : données de référence (catégories, marques, gouvernorats/wilayas, comptes du grand livre, zones **sans tarifs**) ;
3. si `RUN_CATALOGUE_IMPORT=1` : catalogue vérifié 2026, publication des modèles entièrement vérifiés, **sans prix ni stock** (« prix bientôt disponible ») ; l'import est attribué à un compte système suspendu qui ne peut pas se connecter ;
4. `next build`.

Supprimer `RUN_SEED` et `RUN_CATALOGUE_IMPORT` une fois la première mise en ligne réussie.

**Base de données** — l'application se connecte avec un rôle PostgreSQL dédié, `doom_app`, propriétaire des tables du schéma `public`. Les rôles `anon` et `authenticated` de Supabase n'ont **aucun** droit sur ces tables : l'API de données publique de Supabase ne peut donc rien lire (utilisateurs, sessions, KYC…). Ne pas recréer les tables avec le rôle `postgres`, dont les privilèges par défaut les exposeraient.
- `DATABASE_URL` : pooler Supabase en mode transaction (port 6543, `?pgbouncer=true`) ;
- `DIRECT_URL` : pooler en mode session (port 5432) — la connexion directe `db.<ref>.supabase.co` est en IPv6 seulement et n'est pas joignable depuis les builds Vercel.

**Variables de production** — `DATABASE_URL`, `DIRECT_URL`, `APP_URL`, `SESSION_SECRET`, `KYC_ENCRYPTION_KEY`, `CRON_SECRET`, `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_PUBLIC_BUCKET`, `SUPABASE_PRIVATE_BUCKET`. Reste à saisir à la main dans Vercel : **`SUPABASE_SERVICE_ROLE_KEY`** (Supabase → Project Settings → API keys). Sans elle le site fonctionne, mais tout envoi de fichier (photos produits, pièces KYC, preuves de livraison) échoue.

**Compte administrateur** — aucun compte n'est créé par le build. Créer un compte sur `/ar/register`, puis le promouvoir :
```sql
update "User" set role = 'SUPERADMIN' where email = '<votre e-mail>';
```

**Domaine** — ajouter le domaine dans Vercel, puis mettre `APP_URL` à la même valeur et redéployer.

**Protection Vercel** — l'authentification Vercel ne protège que les déploiements de prévisualisation ; la production est publique.

Ensuite : zones de livraison, prix, stocks et photos (voir `docs/CATALOGUE_2026.md`), puis la checklist de la section 6.

> **Plan Vercel Hobby :** les tâches planifiées y sont limitées à une par jour, donc `vercel.json` les déclenche une fois par nuit. Les réservations de stock d'un paiement abandonné ne sont alors libérées qu'une fois par jour. Avant l'ouverture au public, passer au plan Pro et remettre `"*/5 * * * *"` pour `/api/cron/reservations` et `"7 * * * *"` pour `/api/cron/agents`.
