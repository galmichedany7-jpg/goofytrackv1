# PolyTrack Apex

Un mod pour la version bureau de [PolyTrack](https://www.kodub.com) 0.6.3 (Windows) : une voiture de F1, une interface refaite et un multijoueur enrichi.

> Projet de fan, non affilié à Kodub. Ce dépôt ne contient aucun fichier du jeu : le script d'installation transforme votre propre copie de PolyTrack.

![Menu principal](docs/menu.jpg)

## Ce que ça change

**Voiture**
- Carrosserie de F1 : nez, cockpit avec casque et halo, pontons, capot moteur, fond plat, diffuseur, ailerons avant et arrière, feux de freinage.
- Suspension animée, 16 livrées redessinées pour la nouvelle carrosserie.
- Le comportement de conduite est strictement celui d'origine : la forme de collision et la physique ne sont pas modifiées.

![Garage](docs/garage.jpg)

**Interface « Apex »**
- Surfaces sombres translucides, coins arrondis, un seul accent de couleur, police Bahnschrift.
- Les couleurs, rayons et ombres sont des variables en tête de `apex-theme.css`.

**Multijoueur**
- Tableau des 5 meilleurs temps de la room, affiché pendant la course.
- Fantôme du meilleur tour vu dans la room, rejoué à côté de vous.
- Mode course : l'hôte lance une course, les temps déjà faits dans la room servent de qualifications, les voitures partent d'une grille dans cet ordre après cinq feux rouges, et le classement s'affiche à l'arrivée.
- Le code d'invitation se renouvelle tout seul quand il expire.

![Départ d'une course](docs/race.jpg)

## Installation

Il faut [Node.js](https://nodejs.org) 18 ou plus récent et PolyTrack 0.6.3 pour Windows.

```bash
git clone <url-du-depot> polytrack-apex
cd polytrack-apex
node build.js "C:\chemin\vers\PolyTrack-v0.6.3-win32-x64"
```

Fermez le jeu avant de lancer la commande, puis démarrez `PolyTrack.exe` comme d'habitude.

À la première installation, l'archive d'origine du jeu (`resources/app.asar`) est mise de côté sous le nom `app.asar.original` et décompressée dans `resources/app`, que le jeu charge à la place. Relancer `node build.js` reconstruit tout à partir de l'archive d'origine : c'est aussi la commande à utiliser après avoir modifié le mod.

### Désinstallation

```bash
node uninstall.js "C:\chemin\vers\PolyTrack-v0.6.3-win32-x64"
```

Le dossier `resources/app` est supprimé et l'archive d'origine remise en place.

## Compatibilité en ligne

- **Classements officiels** : la physique n'est pas modifiée, vos temps en solo et en room restent comparables à ceux des autres joueurs. Les temps faits pendant une course (départ sur la grille) ne sont ni enregistrés ni envoyés.
- **Joueurs sans le mod** : vous pouvez jouer dans la même room. Le tableau et le fantôme n'utilisent que les données que le jeu échange déjà. Les messages du mode course passent par le type de message que le jeu réserve aux mods et ne sont envoyés qu'aux joueurs qui ont le mod ; les autres continuent simplement à rouler pendant la course.
- **Mise en relation** : le mod utilise le serveur du jeu, comme le jeu d'origine. La durée d'un code d'invitation est fixée par ce serveur.

## Limites connues

- Pas de collisions entre voitures : le moteur physique simule chaque voiture séparément.
- Une course est un trajet départ → arrivée, les pistes ne bouclant pas.
- Le fantôme est reconstruit à partir des positions reçues pendant que vous êtes dans la room (20 par seconde). Un record établi avant votre arrivée n'a pas de fantôme.
- L'aileron avant dépasse la boîte de collision d'origine et peut traverser un mur lors d'un choc frontal.
- Le mod cible exactement la version 0.6.3 : les modifications du code s'appuient sur le code minifié de cette version et le script s'arrête si elles ne s'appliquent pas.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `build.js`, `uninstall.js` | Installation et désinstallation |
| `config.js`, `asar.js` | Emplacement du jeu, lecture de l'archive |
| `build_car.js`, `meshlib.js` | Génération procédurale du modèle 3D de la voiture |
| `build_patterns.js` | Génération des 16 livrées |
| `patch_bundle.js` | Points d'accroche ajoutés au code du jeu |
| `apex-room.js` | Tableau de room, fantôme, mode course |
| `apex-theme.css` | Thème de l'interface |

## Licence

Le code de ce dépôt est sous licence MIT (voir `LICENSE`). PolyTrack et ses contenus appartiennent à Kodub.
