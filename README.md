# GoofyTrack v1

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

**Graphismes**
- Ombres plus douces et un peu plus marquées.
- Ciel plus profond avec un halo autour du soleil, nuages plus lumineux.
- Pièces de piste ombrées en lissé : virages, pentes, loopings, barrières et piliers n'ont plus de facettes visibles. Seul l'ombrage change, calculé une fois au chargement ; la géométrie, qui sert aussi aux collisions, reste identique.
- Ambiances au choix depuis l'écran d'accueil (jour, heure dorée, crépuscule, couvert) : seules les couleurs du ciel et de la lumière changent, sans coût en performance.
- Les voitures et la physique ne sont pas touchées. Tout est dans `apex-gfx.js`, réglable en tête de fichier.

**Aides au pilotage** (solo et multijoueur)
- Mini-carte : le tracé de la piste, votre voiture en flèche et, dans une room, les autres joueurs en points.
- Écart en direct : pendant le tour, votre avance ou votre retard sur votre meilleur tour de la session, mesuré en continu le long de la piste et pas seulement aux points de contrôle.

**Multijoueur**
- Tableau des 5 meilleurs temps de la room, affiché pendant la course.
- Fantôme du meilleur tour vu dans la room, rejoué à côté de vous.
- Le code d'invitation se renouvelle tout seul quand il expire.

**Mode course**

Sur l'écran « Héberger », un troisième mode **Course** s'ajoute à Casual et Competitive, avec ses options : nombre de tours (1 à 20), qualifications et tour de formation. L'hôte peut encore les changer dans la room, entre deux courses. Une course enchaîne :

1. **Entraînement** : chacun roule librement, le tableau affiche les 5 meilleurs temps.
2. **Qualifications** (optionnel) : tours chronométrés libres depuis le départ, le meilleur de chacun compte. L'hôte passe à la suite quand il veut.
3. **Tour de formation** (optionnel) : un tour non chronométré depuis la grille. La course part quand tout le monde l'a bouclé (ou quand l'hôte la lance).
4. **Course** : grille dans l'ordre des qualifications (ou des temps de la room), cinq feux rouges, puis N tours. Le tableau donne le classement en direct (tour en cours, écarts) et un bandeau affiche votre tour et votre dernier temps au tour.
5. **Résultats** : classement final, puis retour à l'entraînement.

Les courses en plusieurs tours demandent un **circuit** : une piste dont la ligne d'arrivée est posée juste derrière le départ (à moins de 50 m), avec ses checkpoints sur le tour. Sur une piste qui ne boucle pas, la course se fait en un seul tour. Le mod ajoute une catégorie **Circuits** aux pistes officielles, après Été, Hiver et Désert, avec le circuit « Killer Loop », un rectangle en route large ([`tracks/killer_loop.track`](tracks/killer_loop.track), généré par [`tracks/make_loop_track.js`](tracks/make_loop_track.js)). Les pistes du mod sont déclarées dans [`tracks/index.js`](tracks/index.js) ; leurs records restent sur votre machine et ne sont jamais envoyés au classement en ligne du jeu, qui ne les connaît pas.

![Départ d'une course](docs/race.jpg)

## Installation

Il faut [Node.js](https://nodejs.org) 18 ou plus récent et PolyTrack 0.6.3 pour Windows.

```bash
git clone https://github.com/galmichedany7-jpg/goofytrackv1.git
cd goofytrackv1
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

- **Classements officiels** : la physique n'est pas modifiée, vos temps en solo et en room restent comparables à ceux des autres joueurs. Les temps faits pendant une course (qualifications, formation, course) ne sont ni enregistrés ni envoyés.
- **Rooms de course** : le serveur du jeu ne connaît que Casual et Competitive ; une room de course est hébergée en Competitive et le mod indique aux joueurs qui l'ont que c'est une room de course.
- **Joueurs sans le mod** : vous pouvez jouer dans la même room. Le tableau et le fantôme n'utilisent que les données que le jeu échange déjà. Les messages du mode course passent par le type de message que le jeu réserve aux mods et ne sont envoyés qu'aux joueurs qui ont le mod ; les autres continuent simplement à rouler pendant la course.
- **Mise en relation** : le mod utilise le serveur du jeu, comme le jeu d'origine. La durée d'un code d'invitation est fixée par ce serveur.

## Limites connues

- Pas de collisions entre voitures : le moteur physique simule chaque voiture séparément.
- Tours multiples : la physique du jeu termine une course dès l'arrivée franchie avec tous les checkpoints. Pendant une course en plusieurs tours, elle reçoit donc la piste avec un checkpoint de plus, hors d'atteinte au-dessus du circuit, et c'est le mod qui compte les tours. Conséquence : à partir du 2e tour, le compteur de checkpoints du jeu reste plein, et « revenir au dernier checkpoint » ramène au dernier checkpoint du tour (et non à celui que vous venez de passer).
- Recommencer pendant une course renvoie sur la grille et remet votre compteur de tours à zéro ; le chrono de course, lui, continue.
- Les temps de course sont mesurés sur l'horloge de chaque joueur depuis l'extinction des feux, à quelques centièmes près selon la latence.
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
| `apex-gfx.js` | Rendu : ombres, ciel, ambiances, ombrage lissé des pièces de piste |
| `apex-hud.js` | Mini-carte et écart en direct |
| `apex-theme.css` | Thème de l'interface |
| `goofytrack-logo.svg` | Logo du menu principal |
| `tracks/` | Pistes du mod (catégorie Circuits) : liste, codes, miniatures, générateur du circuit de test |
| `serve.js` | Développement : sert le jeu modé en http pour le tester dans un navigateur (`node serve.js "C:\chemin\vers\PolyTrack"`) |

## Licence

Le code de ce dépôt est sous licence MIT (voir `LICENSE`). PolyTrack et ses contenus appartiennent à Kodub.
