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
