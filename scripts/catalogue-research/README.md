# Recherche du catalogue vérifié (2026-11-12)

Ces scripts (Python standard, sans dépendance) transforment les pages **officielles** des fabricants
en `data/catalogue/verified-catalogue-2026.json` :

| Marque | Source officielle | Script |
|---|---|---|
| Apple | fiches « Tech Specs » (support.apple.com), numéros de modèle Oman/CCG (`108044`), couleurs officielles (feuille de style apple.com/om) | `apple_extract.py` → `apple_assemble.py` |
| Samsung | catalogue et fiches techniques Samsung Gulf (`searchapi.samsung.com`, codes `SM-…MEA` = Moyen-Orient/Afrique) | `samsung_assemble.py` |
| HONOR | pages « Specs » honor.com/om (Oman) ou honor.com/ae-en (modèles absents d'Oman) | `honor_extract.py` → `honor_oppo_assemble.py` |
| OPPO | pages « Specs » oppo.com/ae (X9 Pro) et oppo.com/en (X8, X8 Pro) | `honor_oppo_assemble.py` |

Principes : aucune valeur n'est inventée ; une caractéristique absente de la source n'est pas écrite ;
les modèles sans page officielle trouvée (OPPO Find X6 Pro, X7 Ultra) restent « à confirmer ».
Les prix, stocks et photos ne viennent jamais de ces fichiers.
Les pages HTML brutes ne sont pas versionnées : relancer le téléchargement pour revérifier.
