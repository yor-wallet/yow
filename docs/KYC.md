# DOOM | دوم — confirmation du compte par e-mail et vérification d'identité

> Décision du propriétaire (14/11/2026) : « confirmation de compte par mail ; vérification d'identité par administrateur : pour chaque nouvel utilisateur, l'administrateur reçoit un mail pour valider ou refuser ».
> Aucun secret dans ce fichier.

## 1. Le parcours

1. **Inscription** → le client reçoit un **e-mail de confirmation** (lien valable 48 h, lié au compte **et** à l'adresse : si l'adresse change, l'ancien lien ne marche plus). Page d'arrivée : `/[locale]/verify-email`. Il peut redemander le lien depuis « Vérification d'identité » (3 fois par heure).
2. **Vérification d'identité** (`/account/verification`) : possible **après** la confirmation de l'e-mail. Le client envoie le recto, le verso de sa carte et un selfie (chiffrés, stockage privé).
3. **E-mail aux administrateurs** : chaque administrateur qui peut décider (rôles **ADMIN** et **SUPERADMIN**, droit `kyc:decide`) reçoit un e-mail avec le nom du client et un lien vers la demande. L'e-mail ne contient **aucune pièce**.
4. **Décision** dans Administration › **Vérifications d'identité** (`/admin/kyc`) : pièces affichées via le visualiseur audité (chaque ouverture est journalisée, liens de 5 minutes), puis **Valider**, **Refuser** (message obligatoire, montré au client) ou **Demander d'autres documents** (message + documents à renvoyer).
5. **E-mail au client** avec la décision (et le motif en cas de refus ou de demande de documents) + notification dans son compte.
6. Une fois **validée**, l'identité ouvre les moyens qui l'exigent (cryptomonnaie : réglage `crypto.requireKyc`, activé).

## 2. Configuration (hébergement)

| Variable | Rôle |
|---|---|
| `BREVO_API_KEY` | Clé d'API Brevo (Brevo → SMTP & API → API keys). **Secret** : à coller directement dans Vercel. **Attention** : si Brevo bloque les adresses IP inconnues (Brevo → Sécurité → Adresses IP autorisées), tout envoi depuis Vercel est refusé (`401 unrecognised IP address`) — Vercel n'a pas d'adresse IP fixe : il faut **désactiver ce blocage**. Ne pas mettre la clé dans un déploiement tant que le blocage est actif : la confirmation d'e-mail deviendrait exigée alors qu'aucun e-mail ne peut partir. |
| `MAIL_FROM` | Adresse d'expédition — doit être un **expéditeur vérifié** dans Brevo. |
| `MAIL_FROM_NAME` | Facultatif, défaut « DOOM \| دوم ». |
| `SUPABASE_SERVICE_ROLE_KEY` | **Indispensable pour les pièces d'identité** (stockage privé). Sans elle, le client ne peut pas envoyer ses pièces. Accepte la nouvelle clé secrète Supabase (`sb_secret_…`, envoyée dans l'en-tête `apikey` seulement) ou l'ancienne clé `service_role`. |

**Tant que l'envoi d'e-mails n'est pas configuré**, rien n'est envoyé (jamais simulé) et la confirmation d'e-mail **n'est pas exigée** (sinon personne ne pourrait la faire) ; l'écran d'administration l'indique. Dès que `BREVO_API_KEY` et `MAIL_FROM` sont présents, la règle s'applique.

Délivrabilité : un expéditeur sur une messagerie gratuite (Gmail, iCloud…) arrive souvent dans les indésirables. Pour de bons résultats, utiliser une adresse sur le domaine du site (ex. `noreply@<domaine>`) authentifiée dans Brevo (SPF, DKIM).

## 3. Où se trouve le code

| Sujet | Fichier |
|---|---|
| Envoi (Brevo), mise en page, échappement | `lib/email/index.ts` |
| Textes des e-mails (ar, en, fr) | `lib/email/templates.ts` |
| Lien de confirmation, confirmation, renvoi | `lib/auth/email-verification.ts`, `app/[locale]/(auth)/verify-email/page.tsx`, `components/account/EmailConfirmCard.tsx` |
| E-mails de vérification d'identité | `lib/kyc/emails.ts` |
| Règle « e-mail confirmé d'abord » | `lib/kyc/index.ts` (`submitKyc`) |
| Écrans d'administration | `app/[locale]/admin/kyc/*`, `lib/admin/kyc.ts` |
| Tests | `tests/unit/email-kyc.test.ts`, `tests/e2e/kyc-admin.spec.ts` |
