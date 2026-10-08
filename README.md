# GoofyTrack v1

Un mod pour la version bureau de [PolyTrack](https://www.kodub.com) 0.6.3 (Windows) : une voiture de F1, une interface refaite et un multijoueur enrichi.

> Projet de fan, non affiliÃ© Ã  Kodub. Ce dÃ©pÃ´t ne contient aucun fichier du jeu : le script d'installation transforme votre propre copie de PolyTrack.

![Menu principal](docs/menu.jpg)

## Ce que Ã§a change

**Voiture**
- Carrosserie de F1 : nez, cockpit avec casque et halo, pontons, capot moteur, fond plat, diffuseur, ailerons avant et arriÃ¨re, feux de freinage.
- Suspension animÃ©e, 16 livrÃ©es redessinÃ©es pour la nouvelle carrosserie.
- Le comportement de conduite est strictement celui d'origine : la forme de collision et la physique ne sont pas modifiÃ©es.

![Garage](docs/garage.jpg)

**Interface Â« Apex Â»**
- Surfaces sombres translucides, coins arrondis, un seul accent de couleur, police Bahnschrift.
- Les couleurs, rayons et ombres sont des variables en tÃªte de `apex-theme.css`.

**Multijoueur**
- Tableau des 5 meilleurs temps de la room, affichÃ© pendant la course.
- FantÃ´me du meilleur tour vu dans la room, rejouÃ© Ã  cÃ´tÃ© de vous.
- Mode course : l'hÃ´te lance une course, les temps dÃ©jÃ  faits dans la room servent de qualifications, les voitures partent d'une grille dans cet ordre aprÃ¨s cinq feux rouges, et le classement s'affiche Ã  l'arrivÃ©e.
- Le code d'invitation se renouvelle tout seul quand il expire.

![DÃ©part d'une course](docs/race.jpg)

## Installation

Il faut [Node.js](https://nodejs.org) 18 ou plus rÃ©cent et PolyTrack 0.6.3 pour Windows.

```bash
git clone https://github.com/galmichedany7-jpg/goofytrackv1.git
cd goofytrackv1
node build.js "C:\chemin\vers\PolyTrack-v0.6.3-win32-x64"
```

Fermez le jeu avant de lancer la commande, puis dÃ©marrez `PolyTrack.exe` comme d'habitude.

Ã€ la premiÃ¨re installation, l'archive d'origine du jeu (`resources/app.asar`) est mise de cÃ´tÃ© sous le nom `app.asar.original` et dÃ©compressÃ©e dans `resources/app`, que le jeu charge Ã  la place. Relancer `node build.js` reconstruit tout Ã  partir de l'archive d'origine : c'est aussi la commande Ã  utiliser aprÃ¨s avoir modifiÃ© le mod.

### DÃ©sinstallation

```bash
node uninstall.js "C:\chemin\vers\PolyTrack-v0.6.3-win32-x64"
```

Le dossier `resources/app` est supprimÃ© et l'archive d'origine remise en place.

## CompatibilitÃ© en ligne

- **Classements officiels** : la physique n'est pas modifiÃ©e, vos temps en solo et en room restent comparables Ã  ceux des autres joueurs. Les temps faits pendant une course (dÃ©part sur la grille) ne sont ni enregistrÃ©s ni envoyÃ©s.
- **Joueurs sans le mod** : vous pouvez jouer dans la mÃªme room. Le tableau et le fantÃ´me n'utilisent que les donnÃ©es que le jeu Ã©change dÃ©jÃ . Les messages du mode course passent par le type de message que le jeu rÃ©serve aux mods et ne sont envoyÃ©s qu'aux joueurs qui ont le mod ; les autres continuent simplement Ã  rouler pendant la course.
- **Mise en relation** : le mod utilise le serveur du jeu, comme le jeu d'origine. La durÃ©e d'un code d'invitation est fixÃ©e par ce serveur.

## Limites connues

- Pas de collisions entre voitures : le moteur physique simule chaque voiture sÃ©parÃ©ment.
- Une course est un trajet dÃ©part â†’ arrivÃ©e, les pistes ne bouclant pas.
- Le fantÃ´me est reconstruit Ã  partir des positions reÃ§ues pendant que vous Ãªtes dans la room (20 par seconde). Un record Ã©tabli avant votre arrivÃ©e n'a pas de fantÃ´me.
- L'aileron avant dÃ©passe la boÃ®te de collision d'origine et peut traverser un mur lors d'un choc frontal.
- Le mod cible exactement la version 0.6.3 : les modifications du code s'appuient sur le code minifiÃ© de cette version et le script s'arrÃªte si elles ne s'appliquent pas.

## Organisation du code

| Fichier | RÃ´le |
|---|---|
| `build.js`, `uninstall.js` | Installation et dÃ©sinstallation |
| `config.js`, `asar.js` | Emplacement du jeu, lecture de l'archive |
| `build_car.js`, `meshlib.js` | GÃ©nÃ©ration procÃ©durale du modÃ¨le 3D de la voiture |
| `build_patterns.js` | GÃ©nÃ©ration des 16 livrÃ©es |
| `patch_bundle.js` | Points d'accroche ajoutÃ©s au code du jeu |
| `apex-room.js` | Tableau de room, fantÃ´me, mode course |
| `apex-theme.css` | ThÃ¨me de l'interface |

## Licence

Le code de ce dÃ©pÃ´t est sous licence MIT (voir `LICENSE`). PolyTrack et ses contenus appartiennent Ã  Kodub.
