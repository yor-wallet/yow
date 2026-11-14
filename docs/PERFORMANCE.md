# DOOM — mesures de performance (laboratoire)

Cibles du cahier des charges (percentile 75, données réelles de visiteurs) : **LCP ≤ 2,5 s**, **INP ≤ 200 ms**, **CLS ≤ 0,10**.
Il n'y a pas encore de visiteurs réels : ces chiffres viennent de `scripts/measure-vitals.mjs` sur la version de production, base de démonstration, **14 novembre 2026**. Ce sont des mesures de **laboratoire** (médiane de 3 essais).
Téléphone : écran 390 px, processeur ralenti 4×, réseau 1,6 Mb/s avec 150 ms de latence. PC : sans limitation.

| Appareil | Page | LCP (ms) | CLS | INP de laboratoire (ms) |
|---|---|---:|---:|---:|
| Téléphone | Accueil | 1176 | 0,007 | **256** |
| Téléphone | Catégorie | 1000 | 0,001 | 104 |
| Téléphone | Produit | 1300 | 0,040 | 112 |
| Téléphone | Panier | 936 | 0,005 | 80 |
| PC | Accueil | 836 | 0,001 | 168 |
| PC | Catégorie | 476 | 0,001 | 72 |
| PC | Produit | 548 | 0,001 | 80 |
| PC | Panier | 460 | 0,002 | 64 |

## Lecture
- **LCP et CLS** : sous les cibles partout, y compris sur un téléphone ralenti.
- **INP** : une seule valeur dépasse la cible, l'accueil sur téléphone ralenti (256 ms). L'interaction mesurée est le changement de thème, qui repeint toute la page ; avec le processeur ralenti 4× c'est le cas le plus défavorable. À surveiller avec de vraies données avant d'optimiser.
- **Avant / après** : le cahier demande une comparaison avant et après les changements ; je n'ai pas de mesure « avant » (les versions précédentes n'ont pas été mesurées). Cette table sert de référence pour les prochaines modifications.
- Refaire la mesure : `BASE=http://localhost:3000 node scripts/measure-vitals.mjs sortie.json` (serveur de production lancé).
