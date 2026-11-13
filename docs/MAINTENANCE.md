# DOOM | دوم — moteur de nettoyage serveur

Cahier des charges du propriétaire, §5. Code : `lib/maintenance/cleanup.ts` · tests : `tests/unit/maintenance-cleanup.test.ts`.

## Ce qui peut être supprimé (liste explicite)

Rien d'autre que ces six types n'est atteignable par le moteur.

| Type | Condition de suppression | Durée de conservation (réglage) | Défaut |
|---|---|---|---|
| `sessions` | session expirée ou révoquée depuis plus longtemps que la durée | `cleanup.sessionsDays` | 30 jours |
| `login_attempts` | tentative de connexion plus ancienne que la durée | `cleanup.loginAttemptsDays` | 30 jours |
| `rate_limits` | compteur dont la fenêtre est close depuis plus longtemps que la durée | `cleanup.rateLimitHours` | 24 heures |
| `idempotency` | clé expirée depuis plus longtemps que la durée, sans traitement en cours | `cleanup.idempotencyDays` | 7 jours |
| `agent_runs` | exécution d'agent terminée, sans proposition rattachée | `cleanup.agentRunsDays` | 90 jours |
| `orphan_images` | images dérivées (`products/`, `campaigns/`) qu'aucun produit ni aucune campagne ne référence, dont **tous** les fichiers ont dépassé le délai de grâce | `cleanup.orphanImagesDays` | 7 jours |

**Jamais touchés** : commandes, paiements, factures et reçus, clients, produits, stocks, paniers, grand livre du portefeuille, KYC, journal d'audit, fichiers du bucket privé, originaux des lots (`data/catalogue/*`).

Les durées sont des réglages (`Setting`, clés `cleanup.*`), modifiables sans redéploiement.

## Garde-fous

- **Aperçu d'abord** : par défaut, le moteur compte et ne supprime rien.
- **Désactivé par défaut** : la tâche planifiée ne fait rien tant que `cleanup.enabled` ne vaut pas `1`.
- **Petits lots** (500 lignes) avec un plafond par exécution ; l'exécution suivante continue.
- **Verrou** (`cleanup.lock`, bail de 10 minutes) : deux exécutions ne se chevauchent jamais ; le bail d'une exécution interrompue expire seul.
- **Revérification au moment de supprimer** : la condition est réévaluée dans la requête de suppression ; pour les images, les références sont relues juste avant chaque lot.
- **Reprise sûre** : une exécution arrêtée en plein lot n'a supprimé que des lignes déjà éligibles ; la relancer termine le travail.
- **Trace** : chaque exécution réelle écrit une ligne `maintenance.cleanup` dans le journal d'audit (nombres supprimés et erreurs par type).

## Utilisation

```bash
npm run maintenance:cleanup                      # aperçu : nombres par type, rien n'est supprimé
npm run maintenance:cleanup -- --only=sessions   # aperçu d'un seul type
npm run maintenance:cleanup -- --apply           # nettoyage réel (mêmes règles que la tâche planifiée)
```

En production : `GET /api/cron/maintenance?dryRun=1` (en-tête `Authorization: Bearer $CRON_SECRET`) renvoie l'aperçu. La tâche planifiée nocturne (`/api/cron/reservations`) lance le nettoyage réel **uniquement** si `cleanup.enabled = 1`.

Mise en service, dans l'ordre : 1) lire l'aperçu ; 2) essayer `--apply` sur la base de développement ; 3) passer `cleanup.enabled` à `1`.

## Résultat de l'aperçu (base de développement, 13 novembre 2026)

| Type | Candidats | Supprimés |
|---|---|---|
| sessions | 0 | 0 |
| login_attempts | 0 | 0 |
| rate_limits | 3 | 0 |
| idempotency | 0 | 0 |
| agent_runs | 0 | 0 |
| orphan_images | 0 | 0 |

La base de production n'a pas encore été examinée par le moteur ; le nettoyage planifié y est désactivé.
