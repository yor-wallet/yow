# Catalogue 2026 — rapport d'intégration

Source reçue : `DOOM_PACK_CATALOGUE_PREMIUM_2026.zip` (48 modèles candidats, CSV/JSON, 4 planches IA, prompt).
Contrôle réalisé le **2026-11-12** sur les pages **officielles** des fabricants. Ce document dit ce qui a été fait, ce qui ne l'a pas été, et pourquoi.

## Résultat
- **46 modèles sur 48 vérifiés** sur une page officielle (Apple 21, Samsung 15, HONOR 7, OPPO 3). Deux modèles restent **à vérifier** : OPPO Find X6 Pro et Find X7 Ultra (aucune page officielle trouvée).
- **420 variantes réelles** (couleur × capacité) créées : 279 Apple (toutes les finitions dans chaque capacité, d'après la fiche Apple de chaque modèle) et 141 Samsung (une variante par référence `SM-…MEA` du catalogue Samsung Gulf, avec sa mémoire vive).
- **Aucune variante inventée** : pas de 128 Go quand le modèle n'existe pas ainsi (ex. iPhone 17 : 256 / 512 Go seulement ; Galaxy S25 Ultra : 256 Go, 512 Go, 1 To).
- **Aucun prix, stock, photo, avis, remise ni badge** n'est créé par l'intégration. Les variantes sont sans prix : la boutique affiche « Prix bientôt disponible » et empêche l'achat tant que l'administration n'a pas saisi le vrai prix et le vrai stock.
- HONOR et OPPO : caractéristiques, couleurs et configurations (RAM + stockage) vérifiées, mais la **matrice couleur × configuration n'est pas publiée** par les sources → ces 10 modèles restent en **brouillon** avec leurs candidats ; l'administration crée les variantes réelles après vérification.

## Ce qui a été ajouté au site
| Zone | Ajout |
|---|---|
| Données | Migration réversible `product_verified_facts` : série, année, sources officielles + date de contrôle, caractéristiques vérifiées ; sur les variantes : stockage (Go), RAM, référence fabricant (`mpn`). |
| Import | `npm run catalogue:import [-- --publish]` ou bouton **Admin → Produits → Importer** : idempotent, audité, n'écrase jamais prix, stock ni modifications. |
| Boutique | Filtres **série** et **année** (dans l'URL), filtres marque/capacité/couleur existants, catégorie **OPPO**, fiches avec 15 à 18 caractéristiques officielles en arabe/anglais/français, sélecteur de couleur → illustration qui change de coloris. |
| Visuels | Tant qu'aucune photo n'existe : **illustration vectorielle originale** (téléphone / pliable, couleur de la variante) toujours légendée « Illustration ». Les 4 planches IA du pack ne sont **pas** présentées comme des photos de produits (règle du pack) ; elles sont conservées dans `public/catalogue/inspiration/` pour d'éventuelles bannières décoratives. |
| Administration | Compteurs et filtres **« produits sans prix » / « sans photo »**, grille de saisie **prix + ancien prix + coût + stock** par produit avec « même capacité » / « toutes les variantes », export/import **CSV** avec simulation, application atomique et journal d'audit. |
| Arabe (RTL) | Capacités, couleurs et noms de modèles gardent l'ordre gauche-droite (« 256 GB », « (PRODUCT)RED »). |

## Modèles
| Marque | Modèle | Année | Fiche officielle | Variantes créées | Matrice couleur × capacité | Source |
|---|---|---|---|---|---|---|
| Apple | iPhone 14 | 2022 | vérifié | 18 | confirmée | https://support.apple.com/en-om/111850 |
| Apple | iPhone 14 Plus | 2022 | vérifié | 18 | confirmée | https://support.apple.com/en-om/111854 |
| Apple | iPhone 14 Pro | 2022 | vérifié | 16 | confirmée | https://support.apple.com/en-om/111849 |
| Apple | iPhone 14 Pro Max | 2022 | vérifié | 16 | confirmée | https://support.apple.com/en-om/111846 |
| Apple | iPhone 15 | 2023 | vérifié | 15 | confirmée | https://support.apple.com/en-om/111831 |
| Apple | iPhone 15 Plus | 2023 | vérifié | 15 | confirmée | https://support.apple.com/en-om/111830 |
| Apple | iPhone 15 Pro | 2023 | vérifié | 16 | confirmée | https://support.apple.com/en-om/111829 |
| Apple | iPhone 15 Pro Max | 2023 | vérifié | 12 | confirmée | https://support.apple.com/en-om/111828 |
| Apple | iPhone 16 | 2024 | vérifié | 15 | confirmée | https://support.apple.com/en-om/121029 |
| Apple | iPhone 16 Plus | 2024 | vérifié | 15 | confirmée | https://support.apple.com/en-om/121030 |
| Apple | iPhone 16 Pro | 2024 | vérifié | 16 | confirmée | https://support.apple.com/en-om/121031 |
| Apple | iPhone 16 Pro Max | 2024 | vérifié | 12 | confirmée | https://support.apple.com/en-om/121032 |
| Apple | iPhone 17 | 2025 | vérifié | 10 | confirmée | https://support.apple.com/en-om/125089 |
| Apple | iPhone 17 Pro | 2025 | vérifié | 9 | confirmée | https://support.apple.com/en-om/125090 |
| Apple | iPhone 17 Pro Max | 2025 | vérifié | 12 | confirmée | https://support.apple.com/en-om/125091 |
| Apple | iPhone 17e | 2026 | vérifié | 6 | confirmée | https://support.apple.com/en-om/126470 |
| Apple | iPhone Air | 2025 | vérifié | 12 | confirmée | https://support.apple.com/en-om/125092 |
| Apple | iPhone 16e | 2025 | vérifié | 6 | confirmée | https://support.apple.com/en-om/122208 |
| Apple | iPhone 18 Pro | 2026 | vérifié | 16 | confirmée | https://support.apple.com/en-om/148590 |
| Apple | iPhone 18 Pro Max | 2026 | vérifié | 16 | confirmée | https://support.apple.com/en-om/148591 |
| Apple | iPhone Duo | 2026 | vérifié | 8 | confirmée | https://support.apple.com/en-om/148588 |
| Samsung | Galaxy S23 | 2023 | vérifié | 8 | confirmée | https://www.samsung.com/ae/smartphones/galaxy-s/ |
| Samsung | Galaxy S23+ | 2023 | vérifié | 8 | confirmée | https://www.samsung.com/ae/smartphones/galaxy-s/ |
| Samsung | Galaxy S23 Ultra | 2023 | vérifié | 12 | confirmée | https://www.samsung.com/ae/smartphones/galaxy-s/ |
| Samsung | Galaxy S24 | 2024 | vérifié | 8 | confirmée | https://www.samsung.com/ae/smartphones/galaxy-s24/specs/ |
| Samsung | Galaxy S24+ | 2024 | vérifié | 7 | confirmée | https://www.samsung.com/ae/smartphones/galaxy-s24/specs/ |
| Samsung | Galaxy S24 Ultra | 2024 | vérifié | 12 | confirmée | https://www.samsung.com/ae/smartphones/galaxy-s24-ultra/specs/ |
| Samsung | Galaxy S25 | 2025 | vérifié | 12 | confirmée | https://www.samsung.com/ae/smartphones/galaxy-s25/specs/ |
| Samsung | Galaxy S25+ | 2025 | vérifié | 8 | confirmée | https://www.samsung.com/ae/smartphones/galaxy-s25/specs/ |
| Samsung | Galaxy S25 Ultra | 2025 | vérifié | 12 | confirmée | https://www.samsung.com/ae/smartphones/galaxy-s25-ultra/specs/ |
| Samsung | Galaxy S26 | 2026 | vérifié | 8 | confirmée | https://www.samsung.com/ae/smartphones/galaxy-s26/specs/ |
| Samsung | Galaxy S26+ | 2026 | vérifié | 8 | confirmée | https://www.samsung.com/ae/smartphones/galaxy-s26/specs/ |
| Samsung | Galaxy S26 Ultra | 2026 | vérifié | 12 | confirmée | https://www.samsung.com/ae/smartphones/galaxy-s26-ultra/specs/ |
| Samsung | Galaxy Z Fold5 | 2023 | vérifié | 9 | confirmée | https://www.samsung.com/ae/smartphones/galaxy-z/ |
| Samsung | Galaxy Z Fold6 | 2024 | vérifié | 9 | confirmée | https://www.samsung.com/ae/smartphones/galaxy-z-fold6/specs/ |
| Samsung | Galaxy Z Fold7 | 2025 | vérifié | 8 | confirmée | https://www.samsung.com/ae/smartphones/galaxy-z-fold7/specs/ |
| OPPO | Find X6 Pro | 2023 | à vérifier | 0 | — | https://www.oppo.com/en/smartphones/series-find-x/ |
| OPPO | Find X7 Ultra | 2024 | à vérifier | 0 | — | https://www.oppo.com/en/smartphones/series-find-x/ |
| OPPO | Find X8 | 2024 | vérifié | 0 | à confirmer | https://www.oppo.com/en/smartphones/series-find-x/find-x8/specs/ |
| OPPO | Find X8 Pro | 2024 | vérifié | 0 | à confirmer | https://www.oppo.com/en/smartphones/series-find-x/find-x8-pro/specs/ |
| OPPO | Find X9 Pro | 2025 | vérifié | 0 | à confirmer | https://www.oppo.com/ae/smartphones/series-find-x/find-x9-pro/specs/ |
| HONOR | Magic5 Pro | 2023 | vérifié | 0 | à confirmer | https://www.honor.com/ae-en/phones/honor-magic5-pro/spec/ |
| HONOR | Magic6 Pro | 2024 | vérifié | 0 | à confirmer | https://www.honor.com/ae-en/phones/honor-magic6-pro/spec/ |
| HONOR | Magic7 Pro | 2025 | vérifié | 0 | à confirmer | https://www.honor.com/om/phones/honor-magic7-pro/spec/ |
| HONOR | Magic8 Pro | 2025 | vérifié | 0 | à confirmer | https://www.honor.com/om/phones/honor-magic8-pro/spec/ |
| HONOR | Magic V3 | 2024 | vérifié | 0 | à confirmer | https://www.honor.com/om/phones/honor-magic-v3/spec/ |
| HONOR | Magic V5 | 2025 | vérifié | 0 | à confirmer | https://www.honor.com/om/phones/honor-magic-v5/spec/ |
| HONOR | Magic V6 | 2026 | vérifié | 0 | à confirmer | https://www.honor.com/om/phones/honor-magic-v6/spec/ |

## À faire par l'équipe (rien ne peut l'être automatiquement)
1. **Saisir les vrais prix et stocks** (Admin → Produits → Importer → exporter « variantes sans prix », remplir, importer). Aucun prix du marché omanais n'a été inventé ni collecté sans source autorisée.
2. **Ajouter les photos officielles** autorisées/licenciées (≥ 1200 px, fond transparent, une image par coloris) via Admin → Produits → Images : elles remplacent automatiquement les illustrations.
3. **Confirmer les combinaisons HONOR / OPPO** (quelles couleurs existent dans quelle capacité à Oman) puis créer leurs variantes ; vérifier OPPO Find X6 Pro / X7 Ultra.
4. **Garantie** : aucune durée n'est inscrite (non publiée par les sources) ; à renseigner selon l'importateur officiel.
5. Vérifier la **disponibilité locale** de chaque modèle (certains modèles anciens ne sont plus vendus à Oman) et archiver ceux qui ne le sont pas.

## Reproductibilité
`scripts/catalogue-research/` contient les scripts qui produisent `data/catalogue/verified-catalogue-2026.json` à partir des pages officielles (voir son README). Les pages brutes ne sont pas versionnées.
