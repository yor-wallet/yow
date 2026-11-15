# DOOM | دوم — photos des produits

Cahier des charges du propriétaire, §4 « صور المنتجات التي يسلّمها صاحب المتجر » et §7. Mise à jour : 15 novembre 2026.

## Règles appliquées

1. **Les photos remises par le propriétaire sont la source** de l'affichage : cartes (accueil, catégories, recherche, suggestions), fiche produit et galerie, panier, tiroir du panier, commande, commandes passées, FLEX.
2. **Une photo est rattachée à une marque, un modèle et une couleur.** Elle sert toutes les capacités de cette couleur. Une photo sans couleur (gamme complète, boîte…) est « générale » et convient à toute sélection.
3. **Quand le client change de couleur, la galerie ne montre que les photos de cette couleur**, puis les photos générales (`lib/catalog/images.ts`). La photo d'une autre couleur n'est jamais affichée à la place : ni dans la galerie, ni en vignette du panier, de la commande ou de FLEX.
4. **Photo absente : le site affiche « الصورة غير متوفرة »** (« Image not available »), et dans la galerie « لا تتوفر صورة لهذا اللون بعد. » quand seule la couleur choisie n'a pas de photo. Aucun dessin ni aucune autre image ne la remplace.
5. **Les originaux sont conservés** (`data/catalogue/<lot>/originals/`). La version du lot en est dérivée (recadrage sur le produit, fond blanc, jamais d'agrandissement, appareil jamais retouché), puis le site sert des copies WebP et AVIF en 480 px et en taille d'origine (`public/photos`) ; le zoom de la galerie utilise la plus grande.
6. **Texte alternatif** : en arabe, il décrit le modèle et la couleur (« صورة iPhone 17 — اللون: Sage ») ; les noms de modèles et de finitions gardent leur écriture officielle.
7. **Le nom d'une finition peut s'écrire autrement que dans le catalogue** (« Titanium Silverblue » / « Titanium Silver Blue ») : la comparaison ignore les majuscules, les espaces et la ponctuation.

## Les deux lots

| Lot | Contenu | Rattachement |
|---|---|---|
| `iphone-visuals-2026` | 26 modèles d'iPhone, 111 visuels studio (un par finition) | chaque visuel est rattaché à sa finition ; les variantes manquantes sont créées sans prix ni stock |
| `doom-photos-2026-11` | photos remises une à une par le propriétaire : 17 modèles, 19 photos | rattachée à la couleur quand le produit la vend déjà (Galaxy S25 Ultra, Galaxy S26 Ultra, iPhone 17, iPhone Air) ; une variante sans prix par photo pour les produits vendus tels quels (AirPods, montres, enceinte) ; sinon photo générale d'un brouillon |

Aucun import ne fixe de prix ni de stock.

## Ajouter des photos

```bash
# 1. Déposer l'original : data/catalogue/doom-photos-2026-11/originals/<identifiant-de-finition>.jpg
# 2. Déclarer le modèle et la finition dans catalogue.json (marque, rayon, couleur, « to_verify »)
npm run catalogue:photos:prepare    # crée les images manquantes du lot (recadrage, fond blanc) ; ne réécrit jamais une image existante
npm run catalogue:photos:build      # copies servies par le site (public/photos)
npm run catalogue:photos -- --bundled   # rattache les photos aux produits (brouillons, sans prix ni stock) ; relançable sans doublon
npm run catalogue:photos:missing    # liste des photos manquantes, à remettre au propriétaire
```

Relancer l'import corrige aussi les bases déjà importées : une photo restée générale alors que le produit vend sa couleur y est rattachée, son texte alternatif arabe est réécrit et ses dimensions sont mises à jour si l'image a été recadrée.

Le personnel peut aussi téléverser une photo depuis *Administration › Produits › fiche produit*, en choisissant la variante (donc la couleur) qu'elle montre.

## Photos reçues et non utilisées

Listées avec la raison dans `data/catalogue/doom-photos-2026-11/catalogue.json` (`excluded`) : 14 photos.
- iPhone identiques aux visuels officiels déjà présents (iPhone 13 Pro, 14, 14 Plus, 15, 15 Pro Max, 16, 17 Pro Max) ;
- 2 photos portant le filigrane d'un autre site (iPhone 17 Mist Blue, iPhone 18 Pro Max) et une capture d'écran (iPhone 14 Pro Max) : la photo officielle déjà présente est utilisée ;
- enceinte Sony verte : modèle non précisé, original gardé dans `originals/pending/` jusqu'à confirmation du nom.

## Photos manquantes (base de production, 15 novembre 2026)

41 produits publiés. **Complets : tous les iPhone publiés, AirPods Max, AirPods Pro 2 et 3, Apple Watch Ultra 2, JBL Boombox 4.** Il manque des photos pour les 15 Samsung publiés :

| Produit | Couleurs sans photo |
|---|---|
| Samsung Galaxy S25 Ultra | Titanium Black, Titanium White Silver, Titanium Gray (Titanium Silver Blue : fournie) |
| Samsung Galaxy S26 Ultra | Sky Blue, Black, White (Cobalt Violet : fournie, ajoutée par cette mise à jour) |
| Samsung Galaxy S23, S23+, S23 Ultra | Lavender, Cream, Green, Phantom Black |
| Samsung Galaxy S24, S24+ | Marble Gray, Onyx Black, Cobalt Violet, Amber Yellow |
| Samsung Galaxy S24 Ultra | Titanium Black, Titanium Gray, Titanium Violet, Titanium Yellow |
| Samsung Galaxy S25, S25+ | Navy, Icy Blue, Mint, Silver Shadow |
| Samsung Galaxy S26, S26+ | Sky Blue, Black, Cobalt Violet, White |
| Samsung Galaxy Z Fold5 | Icy Blue, Cream, Phantom Black |
| Samsung Galaxy Z Fold6 | Navy, Pink, Silver Shadow |
| Samsung Galaxy Z Fold7 | Blue Shadow, Jet Black, Silver Shadow |

Brouillons (non visibles par les clients) qui ont déjà leurs photos mais attendent une confirmation : Apple Watch Series 11, Apple Watch Ultra, iPad Air, iPad mini, HONOR Magic8 Pro, HUAWEI Pura 70, HUAWEI Pura 90s Pro Max, Galaxy Z Fold8 Ultra, iPhone 13 / 13 mini / 13 Pro / 13 Pro Max, iPhone SE (3e génération). Les autres brouillons HONOR et OPPO n'ont pas de photo.

**AirPods Max** : les deux photos remises montrent deux générations (Space Grey : modèle Lightning de 2020 ; Starlight : modèle USB-C de 2024). La couleur Starlight est créée sans prix ; la génération vendue est à confirmer avant de la tarifer.

Cette liste se régénère avec `npm run catalogue:photos:missing`.

## Droits d'usage

Les visuels Apple et Samsung sont des images officielles des fabricants. Leur usage commercial sur le site reste à confirmer par le propriétaire (accord de revendeur ou banque d'images des marques).
