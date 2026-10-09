# GoofyTrack

Mod pour le jeu [PolyTrack](https://www.kodub.com) 0.6.3 (Windows).

> Projet de fan, non affilié à Kodub. Ce dépôt ne contient aucun fichier du jeu : le script d'installation transforme votre propre copie de PolyTrack.

**Version actuelle : 2.5** 
Le détail de chaque version est dans les [patch notes](#patch-notes).

![Menu principal](docs/menu.jpg)

## Ce que ça change

**Voiture**
- Nouvelles Carrosseries de F1
- Nouvelles personnalisations : 16 livrées redessinées pour la nouvelle carrosserie

![Garage](docs/garage.jpg)

**Interface « Apex »**
- Interfaces améliorées
- Les couleurs, rayons et ombres sont des variables en tête de `apex-theme.css`.

**Graphismes**
- Ombres plus douces et un peu plus marquées.
- Ciel plus profond avec un halo autour du soleil, nuages plus lumineux.
- Pièces de piste ombrées en lissé : virages, pentes, loopings, barrières et piliers n'ont plus de facettes visibles. Seul l'ombrage change, calculé une fois au chargement ; la géométrie, qui sert aussi aux collisions, reste identique.
- Ambiances au choix depuis l'écran d'accueil (jour, heure dorée, crépuscule, couvert) : seules les couleurs du ciel et de la lumière changent, sans coût en performance.
- Montagnes redessinées : relief plus fin, chaîne lointaine, roche, neige, forêts de sapins ou rochers selon l'environnement (`apex-scenery.js`).
- Les voitures et la physique ne sont pas touchées. Les réglages sont en tête de `apex-gfx.js` et `apex-scenery.js`.

**Aides au pilotage** (solo et multijoueur)
- Mini-carte : le tracé de la piste, votre voiture en flèche et, dans une room, les autres joueurs en points.
- Écart en direct : pendant le tour, votre avance ou votre retard sur votre meilleur tour de la session, mesuré en continu le long de la piste et pas seulement aux points de contrôle.

**Multijoueur**
- Tableau des 5 meilleurs temps de la room, affiché pendant la course.
- Fantôme du meilleur tour vu dans la room, rejoué à côté de vous.
- Les rooms passent par le serveur GoofyTrack (voir plus bas) : un code d'invitation reste valable tant que l'hôte est dans la room, et seuls les joueurs qui ont exactement le même build du mod peuvent la rejoindre.

**Mode course**

Sur l'écran « Héberger », un troisième mode **Course** s'ajoute à Casual et Competitive, avec ses options : nombre de tours (1 à 20), qualifications et tour de formation. L'hôte peut encore les changer dans la room, entre deux courses. Une course enchaîne :

1. **Entraînement** : chacun roule librement, le tableau affiche les 5 meilleurs temps.
2. **Qualifications** (optionnel) : tours chronométrés libres depuis le départ, le meilleur de chacun compte. L'hôte passe à la suite quand il veut.
3. **Tour de formation** (optionnel) : un tour non chronométré depuis la grille. La course part quand tout le monde l'a bouclé (ou quand l'hôte la lance).
4. **Course** : grille dans l'ordre des qualifications (ou des temps de la room), cinq feux rouges, puis N tours. Le tableau donne le classement en direct (tour en cours, écarts) et un bandeau affiche votre tour et votre dernier temps au tour.
5. **Résultats** : classement final, puis retour à l'entraînement.

Les courses en plusieurs tours demandent un **circuit** : une piste dont la ligne d'arrivée est posée juste derrière le départ (à moins de 50 m), avec ses checkpoints sur le tour. Sur une piste qui ne boucle pas, la course se fait en un seul tour. Le mod ajoute une catégorie **Circuits** aux pistes officielles, après Été, Hiver et Désert, avec le circuit « Killer Loop », un rectangle en route large ([`tracks/killer_loop.track`](tracks/killer_loop.track), généré par [`tracks/make_loop_track.js`](tracks/make_loop_track.js)). Les pistes du mod sont déclarées dans [`tracks/index.js`](tracks/index.js) ; leurs records restent sur votre machine et ne sont jamais envoyés au classement en ligne du jeu, qui ne les connaît pas.

![Départ d'une course](docs/race.jpg)

## Patch notes

Chaque nouvelle version ajoute son paragraphe en haut de cette liste et met à jour `MOD_VERSION` dans [`config.js`](config.js) : c'est le numéro affiché en bas du menu principal (« Mod GoofyTrack V… »).

<!-- Modèle pour une nouvelle version (à copier au-dessus de la plus récente) :

### V2.x : titre court

**Nouveautés**
- …

**Corrections**
- …

**Mise à jour** : ce qu'il faut faire pour passer à cette version (rebuild, serveur…).
-->

### V2.5 : nouveau Monaco, nouveau logo

**Monaco**
- Nouveau décor, entièrement généré par le mod ([`apex-monaco.js`](apex-monaco.js)) à partir du tracé du circuit : plus aucun modèle 3D ni texture extérieurs. La même ville est construite chez tous les joueurs, au chargement de la piste (environ une seconde).
- La mer au sud, avec un port : quais, pontons, yachts amarrés, une digue et son phare, quelques grands yachts au large.
- Une ville dense le long de la route : immeubles aux façades pastel, volets, commerces et auvents au rez-de-chaussée, tours plus haut sur la pente, villas sur les collines.
- Une place de casino avec jardins, fontaine, dôme et tourelles ; des tribunes le long de la ligne droite et face au port ; des palmiers en bord de mer et sur les boulevards.
- Un tunnel sous un hôtel, le long de la mer, à la place du tunnel de l'ancien décor. Les bâtiments, le tunnel et les tribunes projettent leur ombre sur la route.
- Les montagnes boisées sont remplacées, sur Monaco seulement, par des collines de maquis et des sommets de calcaire.
- Le circuit lui-même (route, vibreurs, glissières, points de contrôle) ne change pas : les temps restent comparables.
- L'ancien décor (`tracks/monaco/monaco_decor.bin` et `.jpg`, 4,8 Mo) est supprimé du dépôt et de l'installation.

**Interface**
- Nouveau logo GoofyTrack dans le menu principal ([`goofytrack-logo.svg`](goofytrack-logo.svg)) : lettres carrées penchées, bleu lavande cerné de bleu marine, traits de vitesse. Le thème ne le passe plus en niveaux de gris.

**Mise à jour** : `git pull` puis `node build.js`. L'empreinte du build change (nouvelle version et thème), donc tous les joueurs d'une room doivent passer en V2.5. Le décor de Monaco (`apex-monaco.js`) ne compte pas dans l'empreinte : il ne change que l'affichage.

### V2.4 : collisions entre voitures

En course, les voitures se percutent. Le fantôme du meilleur temps se fait plus discret.

**Collisions**
- Dans une room « Course », pendant le tour de formation et la course, les voitures sont solides les unes pour les autres : on se pousse, on se bloque, un choc à l'arrière propulse la voiture de devant et freine celle de derrière, un choc de côté fait tourner. Pas de collisions en qualifications ni dans les rooms Casual / Compétitif, où tout le monde part du même point.
- Fonctionnement ([`apex-collide.js`](apex-collide.js)) : le moteur physique du jeu (Bullet) simule chaque voiture seule, sur la machine de son pilote. Après chaque pas de simulation (1000 par seconde), la voiture du joueur est comparée aux autres ; au contact, sa vitesse et sa rotation sont modifiées directement dans la mémoire du moteur. Chaque joueur ne déplace que sa propre voiture : les deux machines voient le contact et chacune écarte la sienne.
- Les autres voitures sont affichées là où elles sont maintenant (position extrapolée à partir de leurs dernières mises à jour), et non plus 150 ms en arrière : ce qu'on voit est ce qu'on touche. Elles ne deviennent plus transparentes de près.
- La grille de départ est réelle : la physique fait partir chaque voiture de son emplacement (avant, seule l'image y était, et toutes les voitures partaient en fait de la ligne).
- Une voiture qui réapparaît (retour au checkpoint, redémarrage) dans une autre ne la percute pas : elle redevient solide une fois dégagée.
- Un choc se voit et s'entend chez les deux joueurs (bruit de collision du jeu).

**Fantôme**
- Le fantôme du meilleur temps de la room est plus transparent, et son étiquette (nom et temps) aussi.

**Mise à jour** : `git pull` puis `node build.js`. Nouvelle empreinte de build : tous les joueurs d'une room doivent passer en V2.4. `apex-collide.js` compte dans l'empreinte, puisqu'il change la physique.

### V2.3 : circuit de Monaco

Un circuit entier au tracé libre, avec sa ville, dans la catégorie « Circuits ».

**Circuit**
- Monaco : 1,9 km, route de 15 m de large avec vibreurs et glissières, épingles, tunnel sous un immeuble et un pont, là où la route passe au-dessus d'elle-même. Départ, quatre points de contrôle et arrivée juste derrière la grille (compatible avec les courses en plusieurs tours).
- Le tracé n'est pas fait de pièces de 20 m : c'est un ruban continu, construit à partir de la route d'un modèle 3D de la ville. Le jeu accepte n'importe quel maillage comme pièce de piste, et la physique le prend tel quel ; quatre nouvelles pièces sont déclarées (route, départ, point de contrôle, arrivée), dans le jeu et dans son moteur physique.
- La ville autour (immeubles, port, collines) est ce même modèle, allégé et texturé. Elle est seulement affichée : on ne la percute pas, ce sont les glissières qui gardent les voitures sur la piste.
- Les records sur Monaco restent locaux, comme pour les autres pistes du mod.

**Outils**
- [`tools/make_monaco.js`](tools/make_monaco.js) régénère le circuit à partir du modèle (un `output.obj` et sa texture, non inclus dans le dépôt) : il suit la route du modèle, l'élargit là où une glissière ne passerait pas, et produit les fichiers de [`tracks/monaco/`](tracks/monaco). Les réglages (échelle, largeur, hauteur du pont, départ) sont en tête de fichier.
- Après une régénération, le fichier de piste, sa miniature et les empreintes des pièces (`tracks/monaco/checksums.json`) doivent être recréés dans le jeu ; sans empreintes à jour, le jeu signale ses pièces comme modifiées et n'envoie plus aucun temps au classement officiel.

**Mise à jour** : `git pull` puis `node build.js`. Nouvelle empreinte de build : tous les joueurs d'une room doivent passer en V2.3.

### V2.2.1 : correctif des invitations

**Corrections**
- Deux joueurs avec exactement la même version pouvaient être refusés dans la room de l'autre (« votre version de GoofyTrack n'est pas celle de l'hôte »). L'empreinte du build dépendait des fins de ligne des fichiers, que git peut convertir sous Windows selon les réglages de chacun (et qui diffèrent entre un clone et un ZIP). Elle est maintenant calculée sans en tenir compte.

**Mise à jour** : `git pull` (ou nouveau téléchargement du ZIP) puis `node build.js` chez **tous** les joueurs. L'empreinte change (`2.2.1-…`), et elle doit maintenant être la même pour tout le monde : comparez la ligne `build …` affichée par `node build.js`. Le serveur n'a pas besoin d'être mis à jour.

### V2.2 : décors, aides au pilotage, ambiances

Le jeu est plus beau et donne plus d'informations au pilote, sans toucher à la physique ni au protocole multijoueur.

**Décors**
- Montagnes redessinées dans [`apex-scenery.js`](apex-scenery.js) : relief plus fin, seconde chaîne plus haute à l'horizon, faces colorées selon la pente et l'altitude (herbe, roche et neige en été ; neige, roche nue et glace en hiver ; sable et roche rouge stratifiée dans le désert).
- Forêts de sapins sur les contreforts (été, hiver), rochers dans le désert.
- Le maillage d'origine des montagnes est conservé tel quel pour les collisions : seul ce qui est affiché change.

**Graphismes**
- Ombres plus douces et un peu plus marquées, ciel plus profond avec un halo autour du soleil.
- Pièces de piste ombrées en lissé : virages, pentes, loopings, barrières et piliers n'ont plus de facettes visibles. La géométrie, qui sert aux collisions, est identique.
- Ambiances au choix (jour, heure dorée, crépuscule, couvert) avec le bouton « Ambiance » de l'écran d'accueil. Le choix est propre à chaque joueur.

**Aides au pilotage** (solo et multijoueur, dans [`apex-hud.js`](apex-hud.js))
- Mini-carte : tracé de la piste, votre voiture en flèche, les autres joueurs de la room en points.
- Écart en direct sur votre meilleur tour de la session, mesuré en continu le long de la piste.

**Interface**
- Écran d'accueil : pastille « GoofyTrack 2.2 » sous le logo, icônes et libellés des tuiles recentrés.
- Les liens du bas du menu ne sont plus cliquables (plus aucune redirection vers l'extérieur).

**Corrections**
- Le fichier du thème contenait une marque d'encodage invisible (BOM) qui pouvait casser toute l'interface ; elle est retirée des sources et tolérée par `build.js`.

**Mise à jour** : `git pull` puis `node build.js`. L'empreinte du build change (nouvelle version), donc tous les joueurs d'une room doivent passer en V2.2. Les fichiers `apex-gfx.js`, `apex-hud.js` et `apex-scenery.js` ne comptent pas dans l'empreinte : ils ne changent que l'affichage.

### V2.1 : mise à jour des serveurs

Le multijoueur ne dépend plus des serveurs de PolyTrack.

**Serveur multijoueur GoofyTrack**
- Nouveau serveur de mise en relation dans [`server/`](server/server.js), qui remplace celui de PolyTrack pour héberger et rejoindre une room. La partie reste en pair-à-pair entre les joueurs ; les classements officiels passent toujours par les serveurs de PolyTrack.
- Codes d'invitation à 6 caractères (sans 0/O ni 1/I), valables tant que l'hôte est dans la room : plus d'expiration ni de renouvellement. Minuscules, espaces et tirets sont acceptés à la saisie.
- Déploiement gratuit sur Render avec [`render.yaml`](render.yaml) ; l'adresse du serveur se règle dans `SERVER_URL` de [`config.js`](config.js) (voir [Serveur multijoueur](#serveur-multijoueur)).
- Le jeu réveille le serveur dès son lancement, pour qu'il soit prêt quand on ouvre le multijoueur.
- Serveurs TURN optionnels (variable `ICE_SERVERS`) pour les réseaux qui bloquent le pair-à-pair direct.

**Jeu modifiable**
- Le jeu d'origine bloque le multijoueur quand il détecte une physique ou des fichiers modifiés. Ce blocage est levé pour les rooms GoofyTrack : on peut modifier le jeu comme on veut, du moment que tout le monde a le même build.
- Chaque build calcule une empreinte des fichiers du mod (affichée dans le terminal après `node build.js`, et dans l'infobulle de la ligne « Mod GoofyTrack » du menu). Le serveur ne réunit dans une room que des joueurs qui ont la même empreinte.

**Corrections**
- Mode course visible seulement chez l'hôte : l'hôte n'envoyait la course qu'aux joueurs ayant le même mod que lui et laissait les autres rouler librement, sans aucun message. Un joueur avec un autre build est maintenant refusé dès l'entrée dans la room, avec le message « votre version de GoofyTrack n'est pas celle de l'hôte ».
- L'outil de développement `ApexRoom.debugLap()` (console) compte de nouveau un tour.

**Interface**
- Bas du menu principal : les boutons Google Play, Discord et r/PolyTrack sont retirés. Le copyright Kodub et le crédit de la musique restent, et une ligne « Mod GoofyTrack V2.1 » indique la version installée.

**Mise à jour** : mettre le serveur en ligne (une seule fois), renseigner son adresse dans `config.js`, puis relancer `node build.js` chez **tous** les joueurs avec les mêmes fichiers. Un joueur resté en V2.0 ne peut plus rejoindre une room V2.1.

### V2.0 : mode course

**Mode course**
- Troisième mode **Course** sur l'écran « Héberger », à côté de Casual et Competitive.
- Options : nombre de tours (1 à 20), qualifications et tour de formation, modifiables aussi dans la room entre deux courses.
- Déroulé : entraînement → qualifications (tours chronométrés libres, le meilleur fixe la grille) → tour de formation depuis la grille → départ arrêté aux cinq feux rouges → course en N tours → résultats.
- Classement en direct (tour en cours, écarts) et bandeau avec votre tour et votre dernier temps au tour.
- Les tours faits pendant une course (qualifications, formation, course) ne sont jamais enregistrés comme records.

**Courses en plusieurs tours**
- Sur un circuit dont l'arrivée est juste derrière le départ, la course se fait en plusieurs tours ; sur une piste classique, en un seul.

**Nouvelle catégorie « Circuits »**
- Ajoutée aux pistes officielles, après Été, Hiver et Désert.
- Premier circuit : **Killer Loop**, un rectangle en route large.
- Les records des pistes du mod restent sur votre machine et ne sont pas envoyés au classement en ligne.

**Divers**
- Nouveau logo « GoofyTrack » dans le menu principal.
- Les textes du mod suivent la langue choisie dans le jeu.

### V1.0 : première version

- Voiture de F1 : carrosserie complète, suspension animée, 16 livrées ; physique et forme de collision d'origine.
- Interface « Apex » : surfaces sombres translucides, coins arrondis, police Bahnschrift.
- Multijoueur : tableau des 5 meilleurs temps de la room et fantôme du meilleur tour.
- Code d'invitation renouvelé automatiquement à son expiration (remplacé en V2.1 par des codes sans expiration).


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

- **Classements officiels** : hors course, la physique n'est pas modifiée, vos temps en solo et en room restent comparables à ceux des autres joueurs. Les temps faits pendant une course (qualifications, formation, course) ne sont ni enregistrés ni envoyés.
- **Rooms** : le mod n'utilise plus les serveurs de PolyTrack pour le multijoueur, seulement pour les classements. Les joueurs sans le mod (ou avec un autre build) ne peuvent donc pas rejoindre une room GoofyTrack, et un joueur GoofyTrack ne peut pas rejoindre une room du jeu d'origine.
- **Jeu modifié** : le jeu d'origine refuse le multijoueur s'il détecte une physique ou des fichiers modifiés. Le mod lève ce blocage pour ses propres rooms : vous pouvez changer le jeu comme vous voulez, du moment que tous les joueurs installent le même build.

## Serveur multijoueur

La partie elle-même se joue en pair-à-pair (WebRTC entre l'hôte et chaque joueur). Un serveur ne sert qu'à distribuer les codes d'invitation et à mettre en relation l'hôte et les joueurs qui le rejoignent. Le mod utilise le sien, dans [`server/`](server/server.js) : un petit programme Node qui parle le même protocole que celui de PolyTrack.

- **Codes** : six caractères (sans 0/O ni 1/I), valables tant que l'hôte reste connecté. Minuscules, espaces et tirets sont acceptés à la saisie.
- **Build** : à chaque `node build.js`, une empreinte des fichiers du mod est calculée (affichée par le build, et dans l'infobulle de la ligne « Mod GoofyTrack » du menu). Le serveur refuse un joueur dont l'empreinte diffère de celle de l'hôte, avec un message clair dans le jeu. Après une modification, tout le monde doit donc refaire `node build.js` avec les mêmes fichiers.
- **Adresse** : `SERVER_URL` dans [`config.js`](config.js). La variable d'environnement `GOOFY_SERVER` la remplace le temps d'un build (par exemple `http://localhost:8787/` pour un test local).

### Mettre le serveur en ligne (Render, gratuit)

1. Poussez ce dépôt sur GitHub.
2. Sur [render.com](https://render.com), créez un compte, puis **New > Blueprint** et choisissez le dépôt : le fichier [`render.yaml`](render.yaml) décrit le service (dossier `server/`, offre gratuite).
3. Une fois le service déployé, copiez son adresse (`https://<nom>.onrender.com/`, avec la barre oblique finale) dans `SERVER_URL` de `config.js`, puis relancez `node build.js` chez chaque joueur.

Sur l'offre gratuite, le serveur s'endort après 15 minutes sans connexion et met jusqu'à une minute à se réveiller. Le jeu l'appelle dès son lancement pour qu'il soit prêt quand vous ouvrez le multijoueur. Une room déjà ouverte n'est pas concernée : la connexion de l'hôte le garde éveillé.

### Connexion entre joueurs

Le serveur fournit des serveurs STUN publics (Google, Cloudflare), qui suffisent sur la plupart des connexions domestiques. Si un joueur n'arrive pas à rejoindre (« la connexion a échoué »), son réseau bloque probablement le pair-à-pair direct (certains réseaux 4G, d'entreprise ou d'école) : il faut alors ajouter un serveur TURN. Créez-en un gratuitement (par exemple chez [Metered](https://www.metered.ca/stun-turn) ou Cloudflare Calls), puis renseignez-le sur Render dans la variable d'environnement `ICE_SERVERS`, au format `[{"urls":"turn:...","username":"...","credential":"..."}]`.

### Tester en local

```bash
cd server && npm install && node server.js
```

Dans un autre terminal, construisez une copie du jeu pointée sur ce serveur (`GOOFY_SERVER=http://localhost:8787/ node build.js "C:\chemin\vers\copie"`), servez-la avec `node serve.js "C:\chemin\vers\copie"`, et ouvrez-la deux fois : `http://localhost:8765` et `http://127.0.0.1:8765` (deux adresses différentes donnent deux profils de joueur différents).

## Limites connues

- Collisions : chaque joueur voit les autres avec un léger retard (le temps du réseau), compensé en prolongeant leur trajectoire. Un contact n'est donc pas exactement le même sur les deux écrans, et une voiture qui change brutalement de direction peut être touchée à quelques dizaines de centimètres de l'endroit où elle est dessinée. Les voitures sont testées comme des rectangles vues de dessus : on ne monte pas sur une autre voiture, et deux voitures à plus de 90 cm de hauteur d'écart se croisent sans se toucher.
- Les collisions s'appuient sur l'emplacement des données de la voiture dans la mémoire du moteur physique de la version 0.6.3 ; elles sont vérifiées à chaque utilisation et, si elles ne correspondent pas, les voitures se traversent simplement.
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
| `apex-scenery.js` | Décor : montagnes, forêts, rochers ; affiche la ville des circuits qui en ont une |
| `apex-monaco.js` | Décor de Monaco généré à partir du tracé : ville, port, mer, tunnel, montagnes |
| `apex-collide.js` | Collisions entre voitures en course (page du jeu et moteur physique) |
| `tools/make_monaco.js`, `tracks/monaco/` | Circuit de Monaco : générateur de la route et fichiers produits |
| `apex-theme.css` | Thème de l'interface |
| `goofytrack-logo.svg` | Logo du menu principal |
| `tracks/` | Pistes du mod (catégorie Circuits) : liste, codes, miniatures, générateur du circuit de test |
| `server/`, `render.yaml` | Serveur multijoueur (codes d'invitation, mise en relation) et son déploiement sur Render |
| `serve.js` | Développement : sert le jeu modé en http pour le tester dans un navigateur (`node serve.js "C:\chemin\vers\PolyTrack"`) |

## Licence

Le code de ce dépôt est sous licence MIT (voir `LICENSE`). PolyTrack et ses contenus appartiennent à Kodub.
