# DOOM | دوم — Electronics Store & Service

Marketplace électronique premium pour le **Sultanat d'Oman** — devise **OMR**, langues **arabe
(par défaut, RTL), anglais, français**.

> ⚠️ Projet en cours de construction. L'état réel de chaque module est indiqué dans
> [docs/STATUS.md](docs/STATUS.md) une fois les modules livrés. Aucune fonctionnalité n'est
> déclarée terminée sans implémentation et tests.

## Stack
Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · Motion · next-intl ·
Prisma 6 · PostgreSQL (compatible Supabase) · Vitest · Playwright · PWA · Capacitor (Android/iOS).

## Démarrage local
```bash
cp .env.example .env            # puis renseigner SESSION_SECRET, KYC_ENCRYPTION_KEY, ADMIN_*
npm ci
npx prisma migrate deploy
npm run db:seed                 # catégories, marques, gouvernorats, comptes du grand livre, super-admin
npm run dev                     # http://localhost:3000/ar
```

## Commandes
| Commande | Rôle |
|---|---|
| `npm run dev` / `build` / `start` | Développement / build / production |
| `npm run typecheck` | Vérification TypeScript |
| `npm test` | Tests unitaires (Vitest) |
| `npm run test:e2e` | Tests de bout en bout sur 10 formats d'écran (Playwright) |
| `npm run brand:icons` | Régénère toutes les déclinaisons du logo officiel |
| `npm run catalogue:import` | Applique le catalogue vérifié 2026 (brouillons ; `-- --publish` pour publier les modèles vérifiés) |
| `npm run agents:run` | Exécute les 15 agents IA (propositions à valider dans l'admin) |

## Règles du projet
- Nom **DOOM | دوم**, logo officiel `brand-src/doom-logo-official.png` (jamais redessiné ni recoloré),
  palette violet nuit / bleu électrique / cyan / orange.
- Montants stockés en **baisa** (entiers, 1 OMR = 1000 baisa).
- **Aucun prix, stock, avis ou tarif de livraison inventé** : tout est saisi par l'administration.
- **Aucun paiement confirmé sans confirmation réelle** (API du prestataire ou vérification
  administrative de la valeur encaissée).
- Les intégrations nécessitant un contrat (Ooredoo, Omantel, passerelle carte, crypto, partenaire
  FLEX) sont de vrais adaptateurs, affichés « indisponibles » tant qu'ils ne sont pas configurés.

## Documentation
- [docs/SPEC.md](docs/SPEC.md) — cahier des charges condensé
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architecture, conventions, modules
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — déploiement Vercel + Supabase, checklist de mise en production
- [docs/CATALOGUE_2026.md](docs/CATALOGUE_2026.md) — catalogue vérifié 2026 (sources, variantes, ce qui reste à saisir)
- [docs/ANDROID.md](docs/ANDROID.md) — application Android/iOS (Capacitor) et PWA
- `docs/PAYMENTS.md`, `docs/DELIVERY.md`, `docs/KYC_PRIVACY.md`, `docs/ADMIN.md`, `docs/AGENTS.md` —
  livrés avec leurs modules
