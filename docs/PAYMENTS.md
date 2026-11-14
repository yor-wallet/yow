# DOOM | دوم — paiements, portefeuille, cartes cadeaux et cryptomonnaie

> À lire avec `docs/SPEC.md` (règles du propriétaire). Mis à jour le 14 novembre 2026.
> Aucune clé, aucun secret dans ce fichier : les identifiants du prestataire crypto ne vivent que dans les variables d'environnement.

## 1. Principe

- Le **portefeuille** du client est **en OMR** (baisa entiers), tenu par un **grand livre à double entrée**. DOOM ne détient jamais de cryptomonnaie et n'en convertit jamais : la partie crypto est faite par un **prestataire de paiement agréé**, qui renvoie la **valeur réglée en OMR**.
- Un paiement n'est **jamais** affiché comme confirmé sans confirmation réelle (prestataire vérifié, ou vérification par la finance pour les cartes cadeaux). Un moyen non configuré s'affiche **« indisponible »** avec la raison.
- Les règles ci-dessous sont des **paramètres** (Administration › Réglages › **Paiements**, `/admin/site/settings`). Chaque enregistrement est contrôlé (droit `settings:write` : ADMIN et SUPERADMIN), validé, appliqué tout de suite et **inscrit au journal d'audit** (`settings.payments.update`, valeurs avant / après).

## 2. Les trois demandes du propriétaire

| Demande | Ce que fait le site | État |
|---|---|---|
| **Payer un téléphone en cryptomonnaie** | Moyen `CRYPTO` au paiement de la commande : facture en OMR chez le prestataire agréé, le client paie en BTC / ETH / USDT / USDC sur la page du prestataire, la commande est payée **seulement** quand le prestataire confirme le règlement. | Code prêt. **Indisponible** tant qu'aucun prestataire n'est connecté (variables d'environnement) **et** que `crypto.enabled` = 1. |
| **Recharger le portefeuille** (par crypto ou par échange de carte cadeau, **commission 8 %** sur la carte cadeau) | Recharge crypto : même prestataire, créditée en OMR. Carte cadeau : le client envoie le code (chiffré, doublons détectés) → la finance vérifie la **valeur réellement encaissée** → le portefeuille est crédité de cette valeur **moins la commission**. | Carte cadeau : **en service**, commission **8 %** par défaut (`giftcard.feeBps`). Crypto : comme ci-dessus. |
| **Acheter des cartes cadeaux avec de la crypto** | — | **Pas encore possible** : il faut un fournisseur de codes de cartes cadeaux, des produits « carte cadeau » livrés par voie numérique et une règle « moyens de paiement par catégorie ». À construire quand le fournisseur est choisi. |

Point d'attention : « échanger des cartes cadeaux **contre** de la crypto » n'est pas fait par DOOM — le portefeuille reste en OMR. Remettre de la crypto à un client (retrait, conversion) est une autre activité (conservation / échange), qui demande son propre prestataire et sa propre licence : **non construit**.

## 3. Les paramètres (Administration › Réglages › Paiements)

### Cryptomonnaie
| Paramètre | Clé | Défaut | Effet |
|---|---|---|---|
| Accepter la cryptomonnaie | `crypto.enabled` | **non** | Interrupteur principal. Même activé, le moyen reste indisponible sans prestataire connecté. |
| Payer les commandes en crypto | `crypto.forOrders` | oui | Permet de payer un téléphone, ou toute commande, ainsi. |
| Recharger le portefeuille en crypto | `crypto.forTopup` | oui | Le portefeuille reste en OMR. |
| Exiger la vérification d'identité | `crypto.requireKyc` | **oui** | Seuls les clients dont l'identité est vérifiée (KYC `VERIFIED`) peuvent payer en crypto. |
| Paiement minimum | `crypto.minPaymentBaisa` | vide = minimum du prestataire (1 OMR) | Montant plancher. |
| Paiement maximum | `crypto.maxPaymentBaisa` | vide = aucun plafond propre | Montant plafond. |

### Cartes cadeaux
| Paramètre | Clé | Défaut | Effet |
|---|---|---|---|
| Accepter les cartes cadeaux | `giftcard.enabled` | oui | Éteindre suspend les nouvelles demandes (vague de fraude, par exemple). |
| Commission d'échange | `giftcard.feeBps` | **8 %** | Retenue sur la valeur encaissée. 0 % = tout est crédité. Plage 0 – 50 %. |
| Exiger la vérification d'identité | `giftcard.requireKyc` | non | **Fortement recommandé** d'activer : les cartes cadeaux sont une voie de fraude courante. |
| Cartes en attente par client | `giftcard.maxOpen` | 5 | Limite anti-abus. |

### Plafonds du portefeuille
| Paramètre | Clé | Défaut | Effet |
|---|---|---|---|
| Recharge minimum | `wallet.minTopUpBaisa` | 1,000 OMR | Par recharge (carte, opérateur, crypto). |
| Recharge maximum | `wallet.maxTopUpBaisa` | 500,000 OMR | Par recharge. |
| Solde maximum | `wallet.maxBalanceBaisa` | 2 000,000 OMR | Plafond du portefeuille. À régler selon les règles de **votre licence**. |

Règles de saisie : pourcentages (ex. `8` ou `12,5`), montants en OMR (`1.500`), chiffres arabes acceptés ; **vide = valeur par défaut** ; un maximum ne peut pas être inférieur à un minimum. Une valeur invalide n'enregistre rien.

## 4. La commission de 8 %, concrètement

Carte de **100,000 OMR** vérifiée par la finance (valeur réellement encaissée) :

| Écriture (une seule transaction équilibrée) | Montant |
|---|---|
| Compte d'attente cartes cadeaux (`GIFT_CARD_CLEARING`) | − 100,000 OMR |
| Portefeuille du client | + 92,000 OMR |
| Revenus de la plateforme (`PLATFORM_REVENUE`) | + 8,000 OMR |

- La commission est arrondie au baisa le plus proche et ne peut jamais prendre toute la carte.
- Le pourcentage appliqué, la commission et le montant crédité sont conservés sur la transaction (`grossBaisa`, `commissionBaisa`), sur l'intention de paiement et dans le journal d'audit : changer le pourcentage plus tard ne modifie **pas** les cartes déjà traitées.
- La notification au client indique le montant **réellement crédité**. La page « Carte cadeau » affiche la commission avant l'envoi.
- Relancer la même vérification ne crédite rien de plus (clé d'idempotence).

## 5. Ordre d'activation conseillé

1. **Cadre juridique** : confirmer avec votre conseil les règles applicables à votre licence (cryptomonnaie, monnaie électronique, cartes cadeaux). Ce point n'a pas été vérifié par l'équipe technique.
2. **Prestataire agréé** : contrat, puis variables d'environnement `CRYPTO_PROVIDER`, `CRYPTO_API_URL`, `CRYPTO_API_KEY`, `CRYPTO_WEBHOOK_SECRET` (dans Vercel, jamais dans le code). Le contrat d'API attendu est décrit dans `lib/payments/adapters/crypto.ts`.
3. **Vérification d'identité obligatoire** (`crypto.requireKyc`, et `giftcard.requireKyc` conseillé).
4. **Plafonds** (`crypto.maxPaymentBaisa`, plafonds du portefeuille) fixés avant l'ouverture.
5. Activer `crypto.enabled`, puis tester avec un petit montant réel.

Sécurités déjà en place : codes de cartes chiffrés, empreinte pour refuser les doublons, jamais de crédit sur un code ou une capture seuls, relecteur ≠ propriétaire de la carte, remboursements sur le portefeuille par défaut (pas de renvoi de crypto), alertes de paiement (montant différent, confirmation tardive, etc.).

## 6. Rapprochement et contrôle

`lib/wallet/reconcile.ts` (lecture seule, depuis le centre financier ou une tâche planifiée) vérifie : transactions équilibrées, somme globale nulle, soldes en cache = somme des écritures, aucun portefeuille négatif. À lancer après la première semaine de cartes cadeaux.

## 7. Où se trouve le code

| Sujet | Fichier |
|---|---|
| Clés et valeurs par défaut | `lib/admin/settings.ts` (groupe `payments`) |
| Écran et enregistrement (RBAC, validation, audit) | `lib/admin/payment-settings.ts`, `app/[locale]/admin/site/settings/*` |
| Règles métier (affichage **et** contrôle serveur) | `lib/payments/policy.ts`, `lib/payments/registry.ts`, `lib/payments/core.ts` |
| Cartes cadeaux et commission | `lib/payments/giftcards.ts`, écriture au grand livre dans `lib/payments/core.ts` |
| Plafonds du portefeuille | `lib/wallet/limits.ts` |
| Prestataire crypto | `lib/payments/adapters/crypto.ts` |
| Tests | `tests/unit/payments-settings.test.ts`, `tests/e2e/admin.spec.ts` |

## 8. Reste à décider / à faire

- Choix du **prestataire crypto agréé** et des actifs acceptés (le code accepte BTC, ETH, USDT, USDC).
- **Vente de cartes cadeaux** payée en crypto : fournisseur de codes, produits numériques, règle par catégorie.
- Commission éventuelle sur l'achat de cartes cadeaux (non définie).
- Tableau de bord finance (cartes à vérifier, commissions perçues) : écran d'administration « Finance » encore à construire.
