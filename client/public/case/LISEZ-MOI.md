# Les logos de support des jaquettes

Dépose ici les **vrais** logos qui s'impriment sur les boîtiers de la
Collection. Ils sont posés sur la couverture, en pied du dos et sur la tranche
par `client/src/lib/dvdSkin.js` (constante `MARK_FILES`).

## Les fichiers attendus

| Fichier               | Où il sert                                        |
| --------------------- | ------------------------------------------------- |
| `dvd-video.png`       | pied de couverture + pied de tranche (support DVD) |
| `blu-ray.png`         | idem, pour un titre au format Blu-ray              |
| `zone-2.png`          | cartouche technique du dos (pastille de zone)      |
| `dolby-digital.png`   | cartouche technique du dos (marque sonore)         |
| `16-9.png`            | cartouche technique du dos (format d'image)        |

## Ce qu'il faut respecter

- **PNG à fond transparent.** Un JPEG sur fond blanc laisserait un rectangle
  blanc au milieu d'un pied sombre.
- **Noir ou blanc, peu importe** : la forme est détourée en blanc à la peinture
  (`lightenLogo`), donc un logo noir sur transparent ressort correctement.
- **500 px de large suffisent.** Ces marques ne dépassent jamais 60 px de haut
  dans la texture finale.
- **Le nom du fichier compte** : c'est lui qui fait le lien, pas le contenu.

## Tout est facultatif

Un fichier absent n'est pas une erreur : la face retombe sur le tracé maison
(l'ellipse « DVD VIDEO », le cercle de zone) qui vit dans `dvdSkin.js`. On peut
donc n'en déposer qu'un, ou aucun.

**Ne pas mettre ces images ailleurs que dans `public/`** : elles doivent être
servies depuis NOTRE origine, sinon le canvas qui peint la jaquette est
« souillé » et la texture du boîtier 3D échoue en silence — le boîtier sort
alors d'une seule couleur.
