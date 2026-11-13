# DOOM | دوم — identité visuelle (novembre 2026)

Source : cahier des charges du propriétaire (« تعليمات تنفيذ متجر دوم DOoM »). Signature : **متجرك الإلكتروني للتقنية**.

## Logo
- Fichier maître : `brand-src/doom-logo-official.png` (marque « sac D » jaune, mot-symbole « DOoM », signature).
- Tous les fichiers de `public/brand` et `public/icons` sont produits par `npm run brand:icons` (recadrage et détourage uniquement, jamais redessiné ni recoloré).
- Surfaces claires : logo tel quel. Surfaces sombres : le même logo sur une plaque blanc cassé. Icône d'application : la marque « sac D » plein cadre sur son jaune.

## Couleurs (jetons dans `app/globals.css`)
| Rôle | Couleur | Jeton |
|---|---|---|
| Jaune principal (action principale, texte marine) | `#FEE225` | `yellow` |
| Jaune au survol / à l'appui | `#F5D41C` | `yellow-hover` |
| Marine (titres, prix, texte, icônes, anneau de focus) | `#0A1937` | `night`, `fg`, `accent`, `price`, `ring` |
| Fond du magasin | `#FDFAF6` | `bg` |
| Surface blanche (cartes, champs, fenêtres) | `#FFFFFF` | `surface` |
| Texte secondaire | `#475569` | `muted` |
| Bordure des champs | `#758097` | `border-strong` |
| Succès | `#137047` sur `#E7F6ED` | `success` |
| Alerte | `#805000` sur `#FFF3CB` | `amber` / `orange` |
| Erreur | `#B42318` sur `#FDECEA` | `error` |

Contraste marine sur jaune : 13,35:1. Les anciens noms d'utilitaires (`blue`, `cyan`, `orange`, `amber`) sont conservés et renvoient désormais aux rôles ci-dessus, pour que tous les écrans suivent la palette. Un thème sombre reste proposé au visiteur (surfaces marine, accent jaune).

## Typographie
- Arabe : **IBM Plex Sans Arabic** ; latin : **IBM Plex Sans**. WOFF2 auto-hébergés, graisses 400/500/600/700, `font-display: swap`, repli `Tahoma, Arial, sans-serif`.
- Titres et texte utilisent la même famille (la graisse porte la hiérarchie).

## Mouvement
- Courbe d'entrée `cubic-bezier(.2,.7,.2,1)` ; appui 110 ms (`scale(.98)`), fondu de page et tiroirs 200 ms, survol de carte 150 ms, galerie 220 ms.
- Effets décoratifs retirés : halos néon, bordures holographiques animées, scène d'ambiance. `prefers-reduced-motion` neutralise toutes les durées.

## Reste à faire du cahier des charges
Isolation `<bdi>` systématique des noms/prix mixtes, moteur de nettoyage serveur (aperçu, lots, verrou), liste vérifiée de tous les boutons, mesures LCP / INP / CLS avant-après.
