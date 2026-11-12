# PROMPT MAÎTRE POUR CLAUDE — DOOM / دوم — INTÉGRATION CATALOGUE PREMIUM

Tu es responsable de l’intégration dans le site e-commerce DOOM existant. Utilise le ZIP fourni, inspecte d’abord le code source et la base de données existante, puis applique une mise à jour non destructive.

## Règles impératives
1. NE SUPPRIME et NE CASSE aucune fonctionnalité déjà opérationnelle : connexion, comptes, panier, portefeuille, paiements, livraison, admin, langues, responsive, etc.
2. Les 4 planches PNG du dossier `visuels_inspiration` sont des COMPOSITIONS GÉNÉRÉES PAR IA, pas des photographies officielles ni des fiches produit individuelles. Ne les publie PAS comme photos exactes d’un modèle; elles servent à guider le style visuel et les bannières de catégorie clairement décoratives.
3. `catalogue/produits.json` est une base de modèles et de candidats variantes, PAS une source exhaustive de caractéristiques vérifiées. Pour chaque modèle, vérifier sur le site officiel fabricant, pour le marché Oman/GCC si disponible : nom exact, année, couleur propre à chaque SKU, capacité de stockage vendue, RAM, puce, taille/type écran, résolution, fréquence, caméra principale/ultra-grand-angle/téléobjectif, selfie, batterie, charge filaire/sans-fil, OS, IP, 5G, eSIM, dimensions, poids, contenu boîte. Ne rien inventer. En cas d’absence de preuve, afficher « Caractéristique à confirmer » dans l’admin et garder non publié.
4. Le client souhaite des variantes 128 Go, 256 Go et 512 Go, mais uniquement lorsqu’elles existent pour le modèle précis. Ne jamais créer un 128 Go fictif. Inclure 1 To ou plus lorsque réellement disponible. La couleur et le stockage forment un SKU propre, avec stock, image, prix OMR, disponibilité et code article indépendants.
5. Pas de faux prix, faux stock, faux avis, fausses réductions, faux badges ou fausses promotions. Valeurs à récupérer de la base/admin ou saisir après vérification.

## Catalogue et assets
- Importer les produits du JSON avec upsert idempotent, pas de doublons; sauvegarder/faire migration réversible.
- Prévoir les champs: brand, family, model, year, slug, sku, region, color_name, color_hex, storage_gb, ram_gb, chipset, display, cameras, battery, charging, connectivity, dimensions, weight, os, warranty, price_omr, compare_at_price_omr, stock_quantity, status, image_main, images_gallery, source_url, source_checked_at.
- Une image isolée de qualité studio par variante de couleur et de modèle: face, dos, trois-quarts; idéalement PNG/WebP transparent avec bords nets, 1200 px minimum. Utiliser les visuels officiels autorisés/licenciés ou des rendus réellement fidèles validés. Ne jamais faire croire qu’une illustration IA est la photo exacte du produit vendu.
- Formats WebP/AVIF responsive, `srcset`, lazy loading, blur placeholder, alt descriptif, cache et optimisation LCP. Conserver les originaux et les droits d’utilisation.
- Structurer /public/products/{brand}/{model}/{color}/front.webp, back.webp, angle.webp; ne pas mélanger les couleurs ou modèles.

## Expérience d'achat DOOM
- Page catégorie par marque (Apple, Samsung, OPPO, HONOR), filtres série, année, prix OMR, capacité, couleur, disponibilité; tri.
- Cartes produit avec photo propre, nom exact, capacité sélectionnée, prix OMR réel, état du stock, favoris et bouton Voir détails.
- Page produit immersive avec galerie zoom contrôlé (zoom uniquement sur l’image, jamais le viewport), vues multiples, sélecteur de couleur avec swatches, choix stockage, mise à jour instantanée du prix/stock/photo, spécifications vérifiées, livraison Oman et panier.
- Panier et checkout : montant total serveur, livraison standard 24h ou express 6h avec frais configurables; paiement Ooredoo/Omantel uniquement via intégration commerçant réellement disponible, crypto via fournisseur conforme, et recharge du portefeuille par cartes cadeaux uniquement après validation réelle de valeur. Échéances 3/6/12 mois sans frais uniquement si solution de financement autorisée et activée.
- Arabe RTL prioritaire + français/anglais, libellés précis, interface mobile iPhone Safari/PWA, tablette et ordinateur. Respecter identité visuelle DOOM et animations fluides de 180 à 320 ms, avec prefers-reduced-motion.
- Tableau admin: importer CSV/JSON, valider SKU et caractéristiques, uploader photos, gérer stock/prix, brouillons, publication, promotions, audit des changements.

## Assurance qualité et livraison
- Avant modification : inventaire des fonctionnalités existantes, sauvegarde, plan de migration.
- Tests: chaque modèle/couleur/capacité correspond à un SKU réellement disponible; aucune variante fictive; prix et stock synchronisés côté serveur; image principale change avec couleur; liens, panier, paiements, admin, RTL et navigation retour fonctionnent.
- Tester mobile 320-430 px, tablette 768-1024 px, desktop 1280-1920 px, Safari iOS et Chrome; vérifier accessibilité, SEO, performance et absence d’erreurs console.
- Livrer diff de code, fichiers créés/modifiés, liste des modèles vérifiés et sources, modèles laissés en brouillon, captures avant/après et rapport QA. Ne pas déclarer terminé sans preuve d’intégration.
