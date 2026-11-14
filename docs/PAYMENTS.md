# DOOM | دوم — paiements, portefeuille, cartes cadeaux et cryptomonnaie

> À lire avec `docs/SPEC.md` (règles du propriétaire). Mis à jour le 14 novembre 2026.
> Aucune clé, aucun secret dans ce fichier : les identifiants du prestataire crypto ne vivent que dans les variables d'environnement.

## 1. Principe

- Le **portefeuille** du client est **en OMR** (baisa entiers), tenu par un **grand livre à double entrée**.
- **Cryptomonnaie : USDT envoyé directement vers les adresses du propriétaire** (Tron / TRC20, BNB Smart Chain / BEP20, Ethereum / ERC20). Pas de prestataire intermédiaire. Le site ne connaît que les **adresses publiques** ; il ne détient et ne demande **jamais de clé privée** : les fonds arrivent dans le portefeuille du propriétaire, et le site ne fait que **lire la blockchain** pour vérifier chaque transfert.
- Un paiement n'est **jamais** affiché comme confirmé sans confirmation réelle (transfert vérifié sur la blockchain et définitif, ou vérification par la finance pour les cartes cadeaux). Un moyen non configuré s'affiche **« indisponible »** avec la raison.
- Les règles sont des **paramètres** (Administration › Réglages › **Paiements**, `/admin/site/settings`). Chaque enregistrement est contrôlé (droit `settings:write` : ADMIN et SUPERADMIN), validé, appliqué tout de suite et **inscrit au journal d'audit** (`settings.payments.update`, valeurs avant / après).

## 2. Les demandes du propriétaire

| Demande | Ce que fait le site | État |
|---|---|---|
| **Payer un téléphone (ou toute commande) en crypto** | Moyen `CRYPTO` : le client reçoit le **montant exact en USDT**, l'adresse du réseau choisi et une heure pour envoyer ; il colle l'identifiant de transaction ; le serveur le vérifie sur la blockchain ; la commande est payée quand le transfert est définitif. | Code prêt et testé. **Indisponible** tant qu'aucune adresse valide n'est configurée (variables d'environnement) **et** que `crypto.enabled` = 1. |
| **Recharger le portefeuille** (par crypto ou par carte cadeau, **commission 8 %** sur la carte cadeau) | Crypto : même parcours, le portefeuille est crédité du montant demandé en OMR. Carte cadeau : le client envoie le code (chiffré, doublons détectés) → la finance vérifie la **valeur réellement encaissée** → crédit de cette valeur **moins la commission**. | Carte cadeau : **en service**, 8 % par défaut (`giftcard.feeBps`). Crypto : comme ci-dessus. |
| **Acheter des cartes cadeaux avec de la crypto** | — | **Pas encore possible** : il faut un fournisseur de codes de cartes cadeaux, des produits numériques et une règle « moyens de paiement par catégorie ». Commission prévue : **5 %**. |

Le portefeuille reste en OMR : « échanger une carte cadeau contre de la crypto » devient « la carte est créditée en OMR, moins 8 % ». Remettre de la crypto à un client (retrait, conversion) est une autre activité, **non construite**.

## 3. Le paiement en USDT, pas à pas

1. Le client choisit **« USDT (crypto) »**. La page de paiement affiche le **montant exact** (ex. `910.0237 USDT`), le **réseau** (Tron, BNB Smart Chain, Ethereum), **notre adresse** et l'heure limite (**1 heure**).
2. Il envoie depuis **son** portefeuille (le montant reçu doit être exact : s'il part d'une plateforme d'échange, il ajoute les frais de réseau en plus).
3. Il colle l'**identifiant de la transaction** (hash). Le serveur lit la blockchain et vérifie **tout** :
   - le jeton est l'**USDT officiel** du réseau (contrat Tether) ;
   - le destinataire est **notre adresse** (celle affichée au client) ;
   - le montant correspond **exactement** (4 décimales) ;
   - la transaction date de la fenêtre de ce paiement (pas un ancien virement) ;
   - elle est **définitive** : Tron = état irréversible (nœud « solidity »), BNB Smart Chain = 15 blocs, Ethereum = 12 blocs.
4. Définitif → la commande est payée / le portefeuille crédité (même chaîne de confirmation que les autres moyens : grand livre, idempotence, audit). Pas encore définitif → le paiement attend (le client voit « 7/15 confirmations ») et la page se met à jour toute seule ; une tâche planifiée revérifie aussi.

**Pourquoi un montant unique par paiement.** Tous les clients paient vers la même adresse : c'est le montant, à la 4e décimale, qui relie un transfert à **un seul** paiement. Il se compose des centimes de dollar du prix (arrondis **au centime supérieur**) plus un décalage de 0,0000 à 0,0099 USDT, différent pour chaque paiement ouvert du même prix. Conséquences : un transfert ne peut jamais servir à un autre paiement ; un client ne peut pas « réclamer » le virement d'un autre ; deux clients qui achètent le même téléphone au même moment n'ont pas le même montant. Un identifiant de transaction ne peut être rattaché **qu'une seule fois**, et seulement s'il correspond au paiement.

**Taux.** 1 OMR = **2,6008 USD** (parité officielle du rial omanais) et 1 USDT = 1 USD : calcul exact, sans cours variable. Risque connu : si l'USDT décrochait du dollar, la boutique le subirait.

**Si le transfert ne correspond pas** (autre montant, autre jeton, trop tard…) : le client voit la raison précise, **rien n'est crédité automatiquement**, et une **alerte finance** est créée (centre des alertes) avec le réseau, l'identifiant, le montant attendu et reçu, pour traitement à la main avec le client.

**Sécurité de lecture.** Les réseaux EVM sont lus sur **trois nœuds publics indépendants, deux doivent concorder** (un nœud en panne, bloqué ou en retard ne change rien ; sans accord, on ne crédite pas et on réessaie). Tron est lu sur TronGrid.

### Variables d'environnement (hébergement, jamais dans le code)
| Variable | Rôle |
|---|---|
| `CRYPTO_ADDRESS_TRON` | Adresse de réception Tron (`T…`). Somme de contrôle vérifiée. |
| `CRYPTO_ADDRESS_BSC` | Adresse de réception BNB Smart Chain (`0x…`). **Somme de contrôle EIP-55 obligatoire.** |
| `CRYPTO_ADDRESS_ETH` | Adresse de réception Ethereum (`0x…`). **Somme de contrôle EIP-55 obligatoire.** |
| `CRYPTO_TRONGRID_KEY` *(conseillé)* | Clé d'API gratuite TronGrid : sans elle, TronGrid limite le débit (réponses 429 → « réessayez »). |
| `CRYPTO_RPC_BSC`, `CRYPTO_RPC_ETH`, `CRYPTO_TRONGRID_URL` *(facultatif)* | Nœuds personnalisés (https, séparés par des virgules). |

Une adresse dont la somme de contrôle est fausse est **ignorée** (le réseau est désactivé) : l'argent n'est jamais envoyé vers une adresse mal recopiée. L'adresse affichée au client est **copiée dans le paiement** : changer l'adresse plus tard ne perturbe pas les paiements déjà ouverts. L'écran Réglages › Paiements montre les adresses actives sous forme abrégée (`0xcc77…8608`).

## 4. Les paramètres (Administration › Réglages › Paiements)

### Cryptomonnaie
| Paramètre | Clé | Défaut | Effet |
|---|---|---|---|
| Accepter la cryptomonnaie | `crypto.enabled` | **non** | Interrupteur principal. Même activé, le moyen reste indisponible sans adresse valide. |
| Payer les commandes en crypto | `crypto.forOrders` | oui | Permet de payer un téléphone, ou toute commande, ainsi. |
| Recharger le portefeuille en crypto | `crypto.forTopup` | oui | Le portefeuille reste en OMR. |
| Exiger la vérification d'identité | `crypto.requireKyc` | **oui** | Seuls les clients dont l'identité est vérifiée (KYC `VERIFIED`) peuvent payer en crypto. |
| Paiement minimum | `crypto.minPaymentBaisa` | vide = 1 OMR | Montant plancher. |
| Paiement maximum | `crypto.maxPaymentBaisa` | vide = aucun plafond propre | Montant plafond. |

### Cartes cadeaux
| Paramètre | Clé | Défaut | Effet |
|---|---|---|---|
| Accepter les cartes cadeaux | `giftcard.enabled` | oui | Éteindre suspend les nouvelles demandes (vague de fraude, par exemple). |
| Commission d'échange | `giftcard.feeBps` | **8 %** | Retenue sur la valeur encaissée. 0 % = tout est crédité. Plage 0 – 50 %. |
| Exiger la vérification d'identité | `giftcard.requireKyc` | non | Décision du propriétaire : **non**. Activable à tout moment si des fraudes apparaissent. |
| Cartes en attente par client | `giftcard.maxOpen` | 5 | Limite anti-abus. |

### Plafonds du portefeuille
| Paramètre | Clé | Défaut | Effet |
|---|---|---|---|
| Recharge minimum | `wallet.minTopUpBaisa` | 1,000 OMR | Par recharge (carte, opérateur, crypto). |
| Recharge maximum | `wallet.maxTopUpBaisa` | 500,000 OMR | Par recharge. |
| Solde maximum | `wallet.maxBalanceBaisa` | 2 000,000 OMR | Plafond du portefeuille. À régler selon les règles de **votre licence**. |

Règles de saisie : pourcentages (ex. `8` ou `12,5`), montants en OMR (`1.500`), chiffres arabes acceptés ; **vide = valeur par défaut** ; un maximum ne peut pas être inférieur à un minimum. Une valeur invalide n'enregistre rien.

## 5. La commission de 8 % sur les cartes cadeaux, concrètement

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

## 6. Ordre d'activation conseillé

1. **Cadre juridique** : confirmer avec votre conseil les règles applicables à votre licence (réception de cryptomonnaie, monnaie électronique, cartes cadeaux). Ce point n'a pas été vérifié par l'équipe technique.
2. **Adresses** : saisir `CRYPTO_ADDRESS_*` dans l'environnement d'hébergement (valeurs publiques ; vérifiées par somme de contrôle). Créer une clé gratuite TronGrid (`CRYPTO_TRONGRID_KEY`).
3. **Vérification d'identité obligatoire** (`crypto.requireKyc`, déjà par défaut).
4. **Plafonds** (`crypto.maxPaymentBaisa`, plafonds du portefeuille) fixés avant l'ouverture.
5. Activer `crypto.enabled`.
6. **Test réel de bout en bout avec un petit montant** depuis un portefeuille à vous (le minimum est 1 OMR ≈ 2,61 USDT) : payer, coller l'identifiant, vérifier que la commande ou le portefeuille est crédité, et que les fonds sont bien arrivés dans votre portefeuille.

Sécurités déjà en place : adresses validées, USDT officiel uniquement, montant unique par paiement, transfert rattaché une seule fois, fenêtre de temps, nœuds indépendants, aucune clé privée sur le site ; codes de cartes chiffrés, empreinte contre les doublons, jamais de crédit sur un code ou une capture seuls, relecteur ≠ propriétaire de la carte, remboursements sur le portefeuille par défaut (pas de renvoi de crypto), alertes de paiement.

## 7. Rapprochement et contrôle

`lib/wallet/reconcile.ts` (lecture seule, depuis le centre financier ou une tâche planifiée) vérifie : transactions équilibrées, somme globale nulle, soldes en cache = somme des écritures, aucun portefeuille négatif. À compléter par un contrôle **mensuel à la main** : le total des paiements USDT confirmés du site doit correspondre aux entrées de vos portefeuilles.

## 8. Où se trouve le code

| Sujet | Fichier |
|---|---|
| Clés et valeurs par défaut des réglages | `lib/admin/settings.ts` (groupe `payments`) |
| Écran et enregistrement (RBAC, validation, audit) | `lib/admin/payment-settings.ts`, `app/[locale]/admin/site/settings/*` |
| Règles métier (affichage **et** contrôle serveur) | `lib/payments/policy.ts`, `lib/payments/registry.ts`, `lib/payments/core.ts` |
| Paiement USDT : moyen de paiement | `lib/payments/adapters/crypto.ts`, `lib/payments/crypto-submit.ts`, `lib/payments/crypto-meta.ts` |
| Paiement USDT : adresses, montants, lecture de la blockchain | `lib/payments/onchain/{address,networks,amount,verify}.ts` |
| Page de paiement USDT | `components/payments/CryptoPayPanel.tsx`, `app/[locale]/pay/[intentId]/` |
| Cartes cadeaux et commission | `lib/payments/giftcards.ts`, écriture au grand livre dans `lib/payments/core.ts` |
| Plafonds du portefeuille | `lib/wallet/limits.ts` |
| Tests | `tests/unit/payments-settings.test.ts`, `tests/unit/onchain-crypto.test.ts`, `tests/e2e/crypto.spec.ts`, `tests/e2e/admin.spec.ts` |

## 9. Décisions du propriétaire (14/11/2026) et reste à faire

**Décidé**
- Crypto : paiement **direct vers les adresses du propriétaire** (Tron TRC20, BNB Smart Chain BEP20, Ethereum ERC20), pas de prestataire.
- Commission d'échange sur les cartes cadeaux déposées par les clients : **8 %** (en service, réglable).
- Vérification d'identité pour les cartes cadeaux : **non** (`giftcard.requireKyc` éteint).
- Commission sur l'**achat** de cartes cadeaux (quand cette vente existera) : **5 %** (aucun réglage créé : un réglage sans effet serait un faux réglage).

**À faire / limites connues**
- **Monnaies acceptées : USDT uniquement.** ETH, BNB, TRX et USDC ne sont pas acceptés (cours variable entre l'envoi et la confirmation) ; ajout possible avec une source de prix.
- **Détection automatique** des virements (sans que le client colle l'identifiant) : non faite ; le parcours actuel demande l'identifiant de transaction.
- **Paiement différent du montant demandé** (frais retirés par la plateforme d'échange, montant arrondi…) : refusé et signalé à la finance, à traiter à la main.
- **Vente de cartes cadeaux** payée en crypto : fournisseur de codes, produits numériques, règle par catégorie, commission de 5 %.
- Tableau de bord finance (cartes à vérifier, commissions perçues, paiements USDT à rapprocher) : écran d'administration « Finance » encore à construire.
