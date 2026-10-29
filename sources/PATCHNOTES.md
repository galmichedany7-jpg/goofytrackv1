# Patch notes de GoofyTrack

Chaque nouvelle version ajoute son paragraphe en haut de cette liste (le jeu l'affiche avec le bouton « Patch notes » du menu principal) et met à jour `MOD_VERSION` dans [`config.js`](config.js) : c'est le numéro affiché sous le logo du menu principal (« VERSION … »).

<!-- Modèle pour une nouvelle version (à copier au-dessus de la plus récente) :

## V2.x : titre court

**Nouveautés**
- …

**Corrections**
- …

**Mise à jour** : ce qu'il faut faire pour passer à cette version (rebuild, serveur…).
-->

## V2.21.2 : mode spectateur, vote de session et cartes de joueurs

On peut maintenant regarder une room sans rouler, voler librement autour des replays, voter pour la session suivante, et ouvrir la carte de n'importe quel joueur.

**Mode spectateur**
- **Regarder une room** : le bouton « Regarder » du tableau de la room (ou de la liste des rooms, à côté de « Rejoindre ») gare votre voiture, la cache aux autres et met la caméra sur un autre pilote. « Reprendre le volant » vous remet en piste.
- **Suivre un pilote** : ← → (ou Q D) pour changer de pilote, C pour changer de vue (Poursuite, Large, Embarquée, TV). La molette rapproche ou éloigne la caméra. Un bandeau donne le nom du pilote et son meilleur temps, ou en course sa position et son tour.
- Un spectateur n'a pas de place sur la grille, pas de collisions, et la course ne l'attend ni au départ ni à l'arrivée. Le tableau compte les spectateurs, et la liste des joueurs les grise.

**Caméra libre**
- En spectateur et dans les replays des fantômes (F, ou le bouton en haut de l'écran) : Z Q S D ou les flèches pour avancer, E et A pour monter et descendre, Maj pour aller vite, la molette pour la vitesse, cliquer-glisser pour regarder. Le replay continue de défiler pendant qu'on vole autour. F ou Échap pour en sortir.

**Rooms**
- **Changer de piste** rouvre l'écran de l'hôte : le mode (Décontracté, Compétitif, Course) et la piste se choisissent ensemble.
- **Vote** : avec au moins deux joueurs, la session proposée par l'hôte passe au vote (majorité absolue, l'hôte compte pour, 20 s pour répondre). Les résultats annoncent la session suivante.
- **Tableau de la session** façon F1 : 8 lignes plus la vôtre, les places qui glissent, le record personnel en violet, les places gagnées et un bandeau sous le tableau quand quelqu'un s'améliore.

**Profil et amis**
- Un clic sur un joueur de la liste des joueurs de la room, ou sur un ami, ouvre sa carte (avec un retour vers l'onglet Amis). Les cartes des autres joueurs montrent toutes leurs statistiques.
- Nouveau badge **Record du TGV** : atteindre 574,8 km/h.

**Classements**
- Un record garde la voiture avec laquelle il a été fait, sur les circuits du mod comme sur les classements officiels (pour les temps envoyés à partir de cette version).

**Mise à jour** : « Mettre a jour GoofyTrack.bat » (ou `git pull` puis « Construire GoofyTrack.bat »). Nouvelle empreinte de build : tous les joueurs doivent passer en V2.21.2. Le serveur (Render) doit être redéployé pour les statistiques des cartes, le badge TGV et la voiture des records officiels. Le mode spectateur, lui, ne demande rien au serveur.

## V2.20.1 : le moteur et l'échappement de la R26

La Renault R26 2006 a maintenant son propre bruit de moteur et son échappement, et des cartes simples montrent où tombe un design sur la voiture.

**Pack Renault R26 2006**
- **Moteur** : la carrosserie R26 a son propre bruit de V8, calqué sur un enregistrement embarqué de la vraie voiture. C'est un grondement grave, avec une note forte et un souffle derrière, plutôt qu'un sifflement aigu.
- **Échappement** d'époque : deux sorties ovales qui remontent à travers le dessus des pontons, de part et d'autre du capot moteur, juste devant l'aileron arrière. Elles sont tournées vers le haut et l'arrière, noires à l'intérieur, chacune dans un creux sombre de la carrosserie. C'est une Icône, comme le reste du pack.

**Designs de voitures**
- Trois cartes, `docs/livery_map_standard.svg`, `docs/livery_map_mp4_7a.svg` et `docs/livery_map_r26.svg`, montrent où chaque partie de la voiture tombe sur l'image d'un motif (1024 × 1024) : ailerons, nez, cockpit, capot moteur, flancs et pontons, arrière. L'avant est en haut, et la moitié droite de l'image peint le flanc gauche de la voiture. On peut les garder sous son dessin dans un logiciel graphique.

**Mise à jour** : « Mettre a jour GoofyTrack.bat » (ou `git pull` puis « Construire GoofyTrack.bat »). Nouvelle empreinte de build : tous les joueurs doivent passer en V2.20.1. Le serveur n'a pas besoin d'être redéployé pour cette version.

## V2.20 : Renault R26 2006 et les spins de Forest Speedway

Une deuxième Icône, la Renault de 2006, un garage qui s'ouvre sur la carrosserie, et deux tonneaux sans barrières sur Forest Speedway.

**Pack Renault R26 2006**, la deuxième Icône (à gagner en tournoi ou lors d'un événement GoofyTrack)
- **Motif** : le bleu et le jaune de la voiture championne du monde en 2006, son nez jaune barré d'une bande bleue bordée de blanc, du bleu marine sur le nez, les déflecteurs et les ailerons, une bande jaune le long des pontons et des plumes blanches sur le capot moteur. Ses sponsors revisités : TEAM SPIROU, elfe, HANJINX, RENAUD, Telefolica, i-moche, MARELLE et un « 1 » bleu marine sur le nez.
- **Carrosserie** : sans halo, un petit pare-brise, un nez haut qui plonge vers la suspension avant avec l'aileron avant suspendu dessous, une prise d'air étroite avec sa caméra en T et ses deux petites ailettes, des pontons creusés qui filent vers la boîte de vitesses avec leurs cheminées, des déflecteurs devant eux, et un casque bleu.
- **Aileron** d'époque : à l'avant, un plan principal sous le nez et deux volets sur l'extérieur seulement, entre de hautes dérives courbes ; à l'arrière, un volet très incliné, le petit aileron bas et un seul support.
- **Jantes** à dix branches fines et écrou central, aux couleurs de vos jantes, avec **MICHOULIN** sur les pneus (blanc sur des jantes sombres, noir sur des jantes claires).
- Comme pour la MP4/7A, chaque pièce du pack se monte aussi sur les autres voitures, et les couleurs du motif sont verrouillées tant qu'il est posé.

**Garage**
- Les onglets vont maintenant de la forme de la voiture à ses couleurs : **Carrosserie**, **Aileron**, **Jantes**, **Échappement**, **Motif**, **Peinture**. Le garage s'ouvre sur Carrosserie.

**Forest Speedway**
- **Deux spins** : la route fait faire un tonneau complet à la voiture, sur le mur, la tête en bas au plafond, puis de l'autre côté, avant de la reposer une soixantaine de mètres sur le côté. Le premier remplace la chicane avant la vallée, le second se trouve en haut de la descente vers le pont.
- **Sans barrières** : il faut arriver vite (environ 130 km/h au moins, sinon on tombe au sommet) et garder la voiture au milieu de la bande en corrigeant au volant. Qui le rate part dans le décor, au-dessus d'une fosse.
- **Deux checkpoints de plus**, un avant chaque spin, avec assez d'élan pour repartir depuis l'arrêt après une chute (R) : le tour en compte maintenant 5. La ligne droite principale passe à 570 m environ.
- **Route plus lisse** : les virages qui montent ou descendent (les esses, les épingles de la montagne, l'approche du second spin) ne font plus sentir de petites bosses, et la pente ne casse plus d'un coup aux checkpoints de la montagne.
- La piste a changé : les records de Forest Speedway repartent de zéro.

**Mise à jour** : « Mettre a jour GoofyTrack.bat » (ou `git pull` puis « Construire GoofyTrack.bat »). Nouvelle empreinte de build : tous les joueurs doivent passer en V2.20. Le serveur (Render) doit être redéployé : pour l'Icône R26, et parce que Forest Speedway a changé d'identifiant (liste des pistes de la semaine). Par défaut la Renault va, comme la McLaren, aux comptes #7777 et #0001 (variable `UNLOCKS`, par exemple `mp4_7a:7777+1,r26:7777+1`), et un créateur peut la donner depuis la console du jeu : `ApexAccount.unlock('r26', numéro)`.

## V2.19 : rareté Icône, McLaren MP4/7A 1992 et Forest Speedway

Une nouvelle rareté pour les vraies légendes de la F1, à gagner en tournoi, un nouvel onglet Carrosserie, et un nouveau circuit avec des bacs à graviers.

**Rareté Icône**
- Nouvelle rareté **Icône**, au-dessus de Mythique, avec son cadre bleu-vert : un contour qui tourne, un reflet qui balaie la tuile et des étincelles. Ce sont de vrais designs de F1, sponsors compris (en version parodique), qui ne se gagnent qu'en tournoi ou lors d'événements.
- Sans l'Icône, sa tuile montre la voiture en silhouette noire, « À débloquer » et un cadenas. Un clic dit comment la gagner, sans l'équiper. Le bouton « Aléatoire » ne la tire jamais.
- Une Icône garde ses couleurs d'origine : avec son motif, les couleurs Principale, Secondaire et d'Aileron sont verrouillées, et un message explique pourquoi. Vos couleurs sont gardées et reviennent avec un autre motif. Le châssis et les jantes restent libres.

**Pack McLaren MP4/7A 1992**, la première Icône (à gagner au premier tournoi GoofyTrack)
- **Motif** : les chevrons rouges sur fond blanc de la voiture de Senna en 1992, avec ses sponsors revisités : Malbarré, Pelle (et sa pelle dorée), POWERED by HONTA, COURT-JUS, BOSSE, GOOFYEAR et le « 1 » rouge sur le nez.
- **Carrosserie** : sans halo, un petit pare-brise, un nez bas et arrondi, une grande prise d'air au-dessus du pilote qui file vers le capot moteur, des pontons carrés avec leurs ouïes, et un casque jaune.
- **Jantes** à six branches et écrou central, aux couleurs de vos jantes, avec **GOOFYEAR** et **BEAGLE** en relief sur les pneus (dorés sur des jantes sombres, noirs sur des jantes claires), lisibles des deux côtés.
- **Échappement** à deux sorties ovales et **aileron** d'époque : avant à deux éléments, arrière haut à trois éléments.
- **Son de moteur** : un V12 propre à cette carrosserie, calé sur un enregistrement embarqué de la RA122E à Kyalami en 1992.
- Chaque pièce du pack se monte aussi sur les autres voitures.

**Garage**
- Nouvel onglet **Carrosserie**, en premier : la F1 GoofyTrack ou la MP4/7A. Ailerons, jantes et échappements vont sur les deux.
- Le logo GT sur le nez du motif **Goofy Signature** se lit enfin à l'endroit.

**Forest Speedway**
- Un circuit de Grand Prix imaginaire de 3,1 km dans une vallée boisée au pied des montagnes, dans l'esprit de Trial Mountain : un tracé en 8 qui repasse sur un pont au-dessus de sa propre route, des esses serrés, une montée en lacets entre des parois de roche, un tunnel sous le sommet, puis la descente vers le pont.
- Une route de 18 m de large pour doubler, une grille de départ peinte de 16 cases (le mode Course y place les voitures), une voie des stands (fermée pour l'instant), des stands aux couleurs des équipes, une tour de contrôle, des tribunes, des sapins, des rochers et un lac.
- **Bacs à graviers et herbe** : les barrières sont en retrait, l'herbe freine un peu et les graviers beaucoup. Une voiture qui passe par-dessus une barrière retombe sur l'herbe.
- Sur Forest Speedway et Monaco GP, la voiture apparaît posée sur la route au départ au lieu d'y retomber.

**Mise à jour** : « Mettre a jour GoofyTrack.bat » (ou `git pull` puis « Construire GoofyTrack.bat »). Nouvelle empreinte de build : tous les joueurs doivent passer en V2.19. Le serveur (Render) doit être redéployé pour les Icônes. Qui possède quelle Icône se règle avec la variable `UNLOCKS` (par défaut, la McLaren va aux comptes #7777 et #0001), et un créateur peut en donner une depuis la console du jeu : `ApexAccount.unlock('mp4_7a', numéro)`.

## V2.18 : badges de distance et de temps, chargement 4 fois plus rapide

Douze nouveaux badges à gagner en roulant, un mur pour voir tous les badges du jeu, un démarrage bien plus court et un dossier GoofyTrack enfin rangé.

**Badges**
- **Badges de distance**, gagnés pour de bon quand l'un de vos profils a roulé assez loin, tous vos PC compris : **Baroudeur** (500 km, vert), **Routard** (1 000 km, bleu), **Grand voyageur** (2 500 km, violet), **Globe-trotteur** (5 000 km, or), **Légende du bitume** (10 000 km, rouge) et **Tour du monde** (40 075 km, le tour de la Terre, arc-en-ciel).
- **Badges de temps au volant**, sur le même principe : **Pilote du dimanche** (5 h), **Habitué** (10 h), **Passionné** (25 h), **Accro du volant** (50 h), **Pilote d'endurance** (100 h) et **Une vie au volant** (250 h). Seul compte le temps passé à rouler, pas les menus.
- **Notification** : un bandeau « Nouveau badge ! » s'affiche en haut de l'écran dès qu'un palier est franchi, même en pleine course. Deux badges gagnés en même temps s'affichent l'un après l'autre. Un clic sur le bandeau ouvre vos badges. Chaque badge n'est annoncé qu'une fois, même sur vos autres PC.
- **Onglet Badges** sur votre carte de profil : tous les badges du jeu, distance, temps au volant, podiums des circuits et badges spéciaux. Ceux qui vous manquent sont grisés, avec une jauge jusqu'au palier. Un clic sur un badge gagné le met à côté de votre pseudo, ou l'enlève (deux au plus).
- La distance et le temps au volant sont comptés depuis la V2.17 : ce qui a été fait avant ne compte pas.

**Performances**
- **Chargement du jeu environ 4 fois plus rapide** (de 20 s à 5 s environ sur le même PC) : les pièces des circuits du mod se préparent sans tous les calculs inutiles d'avant, et leurs versions Hiver et Désert ne sont construites que si une piste en a besoin. Le rendu et la physique ne changent pas.
- Connecté à un compte, le jeu n'attend plus que **3 s** au lieu de 8 votre sauvegarde en ligne au démarrage. Le serveur gratuit met souvent plus longtemps à se réveiller : le jeu démarre alors avec la sauvegarde du PC, et vous propose de recharger si une sauvegarde plus récente arrive ensuite.

**Dossier GoofyTrack**
- Le dossier ne montre plus que **`GoofyTrack.exe`**, **`Mettre a jour GoofyTrack.bat`**, **`Construire GoofyTrack.bat`** (reconstruit le jeu) et **`sources`** (tout le code du mod). Les fichiers du jeu sont masqués, comme `.git`.
- « Jouer a GoofyTrack.bat » disparaît : lancez directement `GoofyTrack.exe`, et mettez à jour avec « Mettre a jour GoofyTrack.bat ».
- La mise à jour depuis la V2.17 range le dossier toute seule : les anciens fichiers sont retirés, votre token GitHub est gardé.

**Corrections**
- Crédits du menu principal : « Musics by Teknah ».

**Mise à jour** : « Mettre a jour GoofyTrack.bat » (ou `git pull` puis « Construire GoofyTrack.bat »). Nouvelle empreinte de build : tous les joueurs doivent passer en V2.18. Le serveur (Render) doit être redéployé pour les badges de distance et de temps, avec son dossier racine (Root Directory) à `sources/server`.

## V2.17 : ailerons, statistiques et cadres de profil

Huit ailerons à choisir au garage, un onglet de statistiques sur votre carte, des cadres pour votre profil et la Piste de la semaine choisie par GoofyTrack.

**Garage**
- Nouvel onglet **Aileron** : huit ailerons avant et arrière, chacun avec son nom et sa rareté. *Communs* : **Standard** et **Basse traînée**. *Rares* : **DRS ouvert** et **Haut appui**. *Très rare* : **Cuillère**. *Épique* : **Années 70**. *Légendaire* : **Biplan**. *Mythique* : **Mouette**.
- **Couleur d'aileron** : un nouveau sélecteur sous Peinture. Tant que vous n'y touchez pas, les ailerons gardent le motif et la couleur principale. Le bouton **Auto** les y ramène.
- **Nom de livrée** : le crayon d'une livrée lui donne un nom (« Monaco », « Pluie »…).

**Profil**
- Onglet **Stats** sur votre carte de profil. *Au volant* : distance, temps au volant, vitesses moyenne et max, arrivées. *Mode Course en multijoueur* : courses, victoires, podiums, place moyenne. *Pistes* : pistes officielles, circuits du mod, pistes perso. Et votre place au classement de chaque circuit du mod.
- La carte de profil montre aussi la **distance parcourue** et les **courses gagnées**. Ces compteurs démarrent avec cette version et se cumulent sur tous vos PC.
- **Cadre de profil** (dans Modifier le profil) : sept couleurs au choix, plus des cadres à gagner. **Bronze**, **Argent** et **Or** viennent avec un badge de podium P3, P2 ou P1. Les cadres **Créateur** et **VIP** sont réservés. Vos amis voient votre cadre.
- **Meilleure place affichée** : si vous êtes premier sur plusieurs circuits, choisissez lequel montrer sur votre carte.

**Compte**
- **Sécurité** : changez votre mot de passe, et créez un **code de secours**. Avec ce code, un mot de passe oublié se remplace sans perdre votre sauvegarde. Sans lui, il est perdu : créez-le !
- Julio passe au numéro **#7777** et Shyn au **#0001**. Vos listes d'amis suivent toutes seules.

**Pistes**
- Les pistes communautaires rejoignent les pistes officielles, rangées par environnement (Été, Hiver, Désert, Riviera). L'onglet Communauté disparaît : les tournois prendront sa place.
- La **Piste de la semaine** est maintenant choisie par le serveur GoofyTrack parmi toutes les pistes officielles, circuits du mod compris. Elle s'affiche en haut de l'onglet officiel.

**Interface**
- Le bouton **Patch notes** passe à droite, au-dessus de Conditions et confidentialité.

**Mise à jour** : `git pull` puis `node build.js` (ou `Mettre a jour GoofyTrack.bat`). Nouvelle empreinte de build : tous les joueurs doivent passer en V2.17. Le serveur (Render) doit être redéployé : Piste de la semaine, code de secours, cadres, nouveaux numéros. Sur Render, retirez `RESERVED_IDS` et `CREATOR_IDS` s'ils sont définis, ou mettez-les à `julio:7777,shyn:1` et `7777,1`.

## V2.16 : 18 nouveaux designs et des badges

Dix-huit nouveaux motifs, des raretés pour les jantes et les échappements, et un profil qui se modifie sans quitter l'accueil, avec des badges à côté de votre pseudo.

**Nouveaux motifs**
- *Mythiques* : **Goofy Signature** (le logo GoofyTrack sur les pontons et le nez) et **Champion** (des couronnes de lauriers, des ailerons en damier).
- *Légendaires*, une édition par circuit, aux côtés de la Monaco GP Edition : **Spa Edition** (la vague de l'Eau Rouge et la pluie des Ardennes), **Strasbourg Edition** (les colombages alsaciens et la flèche de la cathédrale), **Dijon Edition** (une bande moutarde et les tuiles vernissées de Bourgogne), **Montbéliard Edition** (les bandes de sécurité des usines, un écusson, les rouleaux de la chaîne), **Goofy Coaster Edition** (des rails qui serpentent sur toute la voiture) et **Killer Loop Edition** (des bandes qui s'enroulent comme la boucle).
- *Épiques* : **Camouflage**, **Flammes**, **Tigre**. *Très rares* : **Éclair**, **Code-barres**, **Carbone**.
- *Rare* : **Numéro géant**. *Communs* : **Bande diagonale**, **Bouts d'ailerons**, **Pointillés**.

**Raretés**
- Les **jantes** et les **échappements** ont aussi un nom et une rareté, avec le même cadre de couleur que les motifs. Légendaires : la jante **Turbine** et l'échappement **Canon XXL**.
- Les trois listes du garage sont triées par rareté : les plus communes en haut, les plus rares en bas.
- Les noms longs passent sur deux lignes dans les tuiles.
- Pour l'instant toutes les pièces restent libres : les coffres pour les débloquer viendront plus tard.

**Profil et badges**
- **Modifier le profil** (sur votre carte de profil, clic sur le badge en haut à gauche) ouvre une fenêtre juste là, sur l'accueil : votre pseudo, votre drapeau (avec une recherche) et vos badges. Plus de détour par le garage.
- **Badges** : jusqu'à deux à côté de votre pseudo, sur l'accueil, votre carte, la liste d'amis de vos amis et la page des pistes. Pour commencer : **Co-créateur de GoofyTrack**, **VIP** (un diamant violet et rose, pour nos amis et les premiers joueurs) et le **podium** de chaque circuit du mod : un bouton doré **P1**, argenté **P2** ou bronze **P3** avec le tracé du circuit (au survol, « P1 de Monaco GP » par exemple), que vous gardez tant que vous gardez votre place au classement de ce circuit.

**Mise à jour** : `git pull` puis `node build.js` (ou `Mettre a jour GoofyTrack.bat`). Nouvelle empreinte de build : tous les joueurs doivent passer en V2.16. Le serveur (Render) doit être redéployé pour les badges.

## V2.15 : trois livrées, des motifs rares et la Monaco GP Edition

Le garage ne s'occupe plus que de la voiture : votre pseudo et votre drapeau restent sur votre carte de profil. Et chaque motif a maintenant un nom et une rareté.

**Raretés**
- Chaque motif de l'onglet **Motif** porte un nom et une rareté, dont la couleur fait le cadre : **Commun** (gris), **Rare** (vert), **Très rare** (bleu), **Épique** (violet), **Légendaire** (jaune), **Mythique** (rouge). Le motif choisi est entouré de blanc.
- Nouveau motif **Monaco GP Edition**, *légendaire* : le partage du drapeau monégasque (votre couleur principale en haut, la secondaire sur le bas des flancs, sous un filet), des ailerons et une bande en damier, et les losanges des Grimaldi sur le nez.
- Les livrées affichent le motif qu'elles portent et sa rareté.
- Pour l'instant tous les motifs restent libres : les coffres pour les débloquer viendront plus tard.

**Livrées**
- Le bouton **Changer de profil** du garage devient **Livrées** : trois designs de voiture enregistrés, à choisir en un clic. La livrée choisie passe tout de suite sur votre voiture, dans les classements comme en ligne.
- **Enregistrer** garde vos modifications dans la livrée choisie, sans rouvrir la fenêtre du pseudo et du drapeau. Changer de livrée garde d'abord ce que vous avez modifié.
- Un emplacement vide part d'une copie de votre voiture actuelle : de quoi essayer une variante sans perdre l'original.
- Les deux autres livrées sont garées à côté de votre voiture dans le garage.
- Vos livrées suivent votre compte GoofyTrack sur tous vos PC. Au premier lancement, votre voiture actuelle devient la livrée 1.

**Profil**
- Le pseudo et le drapeau ne se changent plus au garage, mais avec **Modifier le profil** sur votre carte de profil (clic sur le badge en haut à gauche).
- **Changer de profil** (et l'import d'un profil) passe aussi sur la carte de profil.

**Mise à jour** : `git pull` puis `node build.js` (ou `Mettre a jour GoofyTrack.bat`). Nouvelle empreinte de build : tous les joueurs doivent passer en V2.15. Rien à changer sur le serveur.

## V2.14 : fini les codes, rejoignez d'un clic

**Liste des rooms**
- L'écran **Multijoueur** affiche maintenant les **rooms en cours** : l'hôte et son drapeau, la piste, le mode (Casual, Compétitif, Course et son nombre de tours), où en est la course (essais, qualifications, en course…) et le nombre de joueurs. Un clic sur **Rejoindre** et vous y êtes, plus besoin de s'échanger un code.
- La liste se met à jour toute seule toutes les 4 secondes. Une room pleine est marquée « Pleine ».
- Le code d'invitation marche toujours, sur une ligne sous la liste.
- Sur l'écran **Héberger**, le bouton **Visible dans la liste des rooms** (activé par défaut) permet de garder une room pour soi : seuls vos amis et ceux qui ont le code peuvent alors la rejoindre.
- Seules les rooms du même build apparaissent : celles que vous pouvez vraiment rejoindre.

**Rejoindre un ami**
- Dans l'onglet **Amis**, le bouton **Rejoindre** apparaît dès qu'un ami est **dans une room**, qu'il l'héberge ou qu'il l'ait rejointe (« Dans une room »). Avant, il fallait que l'ami soit l'hôte.
- Vos amis voient votre room tout de suite, sans attendre la présence suivante.

**Mise à jour** : `git pull` puis `node build.js` (ou `Mettre a jour GoofyTrack.bat`). Nouvelle empreinte de build : tous les joueurs doivent passer en V2.14. Le serveur (Render) doit être redéployé avec cette version : sans lui, la liste reste vide (« Serveur injoignable »), mais les codes marchent toujours.

## V2.13 : votre compte GoofyTrack, vos amis, partout

Une version tournée vers les joueurs : un compte pour retrouver sa progression sur tous ses PC, un profil qui a enfin une tête, et des amis à rejoindre en un clic.

**Votre profil, en haut à gauche**
- Un badge sur l'écran d'accueil : **votre voiture** telle qu'elle apparaît dans les classements, votre drapeau et votre pseudo. Changez de livrée au garage ou de profil : il suit tout de suite.
- Juste en dessous, votre compte et son numéro (par exemple « Julio · #0001 »), avec un point vert quand tout est synchronisé, « Hors ligne » si le serveur ne répond pas, ou « Se connecter » tant que vous n'avez pas de compte.
- Un clic ouvre votre **carte de profil** : pistes bouclées, circuits du mod bouclés, **meilleure place en ligne** (par exemple « P1 Monaco GP »), pistes perso, et les circuits que vous avez créés.
- **Modifier le profil** : changez de pseudo et de drapeau sans passer par le garage. La fenêtre du jeu s'ouvre directement, et vous revenez au menu une fois enregistré.

**Votre compte GoofyTrack**
- Un pseudo et un mot de passe, et votre progression vous suit sur chaque PC : profils (pseudo, voiture, identité sur les classements), **records et leurs fantômes**, pistes perso, réglages et touches, ambiance, mini-carte et options de course.
- **Rien n'est perdu** : à la connexion, ce que le PC avait déjà est fusionné avec le compte. Pour chaque piste, le meilleur temps est gardé. Pour une piste perso ou un réglage, la version la plus récente l'emporte.
- **Zéro effort ensuite** : la sauvegarde part quelques secondes après chaque record et revient au lancement du jeu. Serveur endormi ou pas d'internet ? Le jeu démarre quand même, la synchronisation se fera plus tard.
- **Privée** : la sauvegarde est chiffrée sur votre PC avec une clé tirée de votre mot de passe. Le serveur ne voit ni le mot de passe, ni vos données. En contrepartie, **un mot de passe oublié ne se réinitialise pas** : la copie en ligne serait perdue, pas celle de vos PC.
- « Se déconnecter » arrête la synchronisation et laisse tout sur le PC.

**Sur un autre PC**
1. Installez GoofyTrack comme d'habitude, puis lancez-le.
2. Cliquez sur le badge en haut à gauche, puis « Se connecter ».
3. Entrez votre pseudo et votre mot de passe : le jeu récupère tout et redémarre. Vous retrouvez votre voiture, vos temps et vos pistes.

**Amis et rooms**
- Chaque compte a un **numéro de joueur** unique : #0001, #0002… Un clic sur le vôtre, dans la carte du profil, le copie pour le donner.
- Onglet **Amis** : ajoutez un ami avec son numéro. Il reçoit une demande (point rouge sur son badge) et l'accepte d'un clic. Si vous vous ajoutez tous les deux, c'est immédiat.
- Pour chaque ami : sa voiture, son drapeau, et ce qu'il fait (en ligne, en jeu, **héberge une room**, ou « vu il y a 2 h »).
- **Rejoindre** : quand un ami héberge une room, un bouton vous y emmène directement, sans taper de code. Le code n'est montré qu'à ses amis.

**Les créateurs des maps**
- Sur la page d'une map, le nom de son créateur devient cliquable quand il a un compte GoofyTrack : il ouvre sa **fiche de joueur**, avec ses stats, sa meilleure place, les circuits qu'il a créés, et un bouton pour l'ajouter en ami.
- Killer Loop et Monaco GP mènent à Julio, les autres circuits du mod à Shyn dès qu'il aura son compte.
- Les co-créateurs du jeu ont une **coche dorée** à côté de leur nom (« Co-créateur de GoofyTrack »). Le #0001 revient à Julio.

**Comment c'est fait**
- [`apex-account.js`](apex-account.js) : badge, cartes, amis et synchronisation. Le stockage du jeu est surveillé (`Storage.prototype.setItem`) pour savoir quoi envoyer, et le jeu attend la sauvegarde du compte (8 s au plus) avant de lire la sienne ([`patch_bundle.js`](patch_bundle.js)).
- La sauvegarde est une liste d'entrées (profil, record, piste, réglage), chacune avec l'heure de sa dernière modification. Une suppression est gardée pour être reportée sur les autres PC. Elle est compressée puis chiffrée en AES-GCM, avec une clé PBKDF2 (310 000 tours). Une deuxième clé tirée du même mot de passe sert à se connecter, et le serveur n'en garde qu'une empreinte scrypt.
- Deux PC qui envoient en même temps ne s'écrasent pas : le second reçoit la version la plus récente, la fusionne et renvoie.
- La miniature de la voiture est celle des classements du jeu, cadrée de face pour tenir dans le rond, et gardée en mémoire pour le lancement suivant.
- « Rejoindre » ouvre le menu multijoueur et entre le code comme le ferait le joueur. « Modifier le profil » ouvre la fenêtre de profil du garage puis referme le garage derrière elle.

**Serveur**
- Comptes ([`server/accounts.js`](server/accounts.js)) : un fichier par compte dans un second Gist secret (« GoofyTrack accounts »). Routes `/account/register`, `/login`, `/save`, `/presence` (toutes les 30 s), `/friends`, `/player` (fiche publique, sans compte).
- Le jeu qui héberge une room indique au serveur multijoueur à quel compte elle appartient, pour la montrer à ses amis.
- `RESERVED_IDS` (`julio:1`) garde le #0001 pour Julio, `CREATOR_IDS` (`1`) donne la coche dorée.

**Mise à jour** : `Jouer a GoofyTrack.bat` (ou `git pull` puis `node build.js`). Nouvelle empreinte de build : tous les joueurs d'une room doivent passer en V2.13. Le serveur doit être redéployé **avec `GITHUB_TOKEN` sur Render**, sinon les comptes et les classements sont effacés à chaque mise en veille du serveur.

## V2.12 : GoofyTrack.exe, patch notes dans le jeu, Dijon en détail

**Le jeu**
- GoofyTrack devient un jeu à part entière : `GoofyTrack.exe`, avec son icône et son nom (Explorateur, raccourcis, Gestionnaire des tâches, titre de la fenêtre), à la place de `PolyTrack.exe`.
- Un seul dossier : le jeu, son code et sa mise à jour (`Jouer a GoofyTrack.bat`, `Mettre a jour GoofyTrack.bat`) sont au même endroit. Le dossier de PolyTrack n'est plus utilisé, vous pouvez le supprimer.
- Vos sauvegardes (temps, pistes, réglages) sont conservées.

**Patch notes**
- Nouveau bouton **Patch notes** en bas du menu principal : le détail de chaque version, la plus récente dépliée. Un point rouge signale une version pas encore lue.

**Dijon**
- La ville est dessinée en détail le long du circuit, comme Monaco GP : façades avec fenêtres, appuis et volets, boutiques et auvents au rez-de-chaussée, corniches, balcons, toits mansardés en ardoise avec lucarnes, cheminées sur les toits de tuiles.
- Platanes et réverbères le long des boulevards.
- Le détail s'efface avec la distance à la route, et les façades qu'on ne voit pas depuis la piste restent simples.

**Courses (mode Course)**
- Les tours de qualifications comptent comme en contre-la-montre : record personnel, classement de la piste, fantôme. Le tour de formation et la course ne comptent toujours pas.

**Serveur**
- Sur Render sans `GITHUB_TOKEN`, le serveur prévient que les records seront perdus à chaque redémarrage ; la page `/health` indique où ils sont gardés.

**Outils**
- [`setup.js`](setup.js) copie PolyTrack dans le dossier et le transforme en `GoofyTrack.exe` ([`tools/rebrand_exe.ps1`](tools/rebrand_exe.ps1)) ; `uninstall.js` est retiré (pour désinstaller, supprimez le dossier).
- Les patch notes passent du README à ce fichier, que `build.js` intègre au jeu ([`apex-notes.js`](apex-notes.js)).

**Mise à jour** : `Jouer a GoofyTrack.bat` (ou `git pull` puis `node build.js`). La première fois, le jeu est copié depuis votre dossier PolyTrack (retrouvé tout seul ou demandé). Nouvelle empreinte de build : tous les joueurs d'une room doivent passer en V2.12. Le serveur doit être redéployé pour l'avertissement sur les records.

## V2.11 : présentation du circuit, podium, Goofy Coaster sans secousses

**Courses (mode Course)**
- **Présentation du circuit** : au lancement de la course, la caméra survole le circuit pendant 3 secondes, puis replonge derrière la voiture ; les feux s'allument ensuite. Espace ou un clic pour passer. Le départ reste le même pour tout le monde : passer la présentation rend seulement la caméra plus tôt.
- **Podium** : quand tous les pilotes ont fini leurs tours, une estrade se dresse sur la ligne droite de départ, avec les voitures des trois premiers sur les marches 1, 2 et 3 (les suivants à côté, sur la route), leur nom et leur temps au-dessus, et des confettis. Espace ou un clic pour reprendre la main ; l'estrade disparaît alors pour ce joueur. La voiture n'est pas pilotée pendant qu'on regarde le podium.
- Les deux scènes ne déplacent la caméra que pour l'image affichée ([`apex-show.js`](apex-show.js)) : la caméra du jeu, la physique et le chronométrage ne changent pas.

**Goofy Coaster**
- Dans le mur, le tire-bouchon et le looping, la voiture sautillait comme sur une route bosselée. La route y était découpée trop grossièrement : un rectangle vrillé coupé en deux triangles fait une arête de près de 10 cm le long de sa diagonale. Ces passages ont maintenant jusqu'à huit fois plus de sections, sur une courbe continue, et des bandes quatre fois plus étroites. Mesuré sur le moteur physique du jeu, à 200 km/h : les secousses sont divisées par 3 environ dans les virages relevés, par 50 là où la route est presque verticale.
- Le tracé, les points de contrôle et l'identifiant de la piste ne changent pas : les records sont conservés. Le jeu met environ une seconde de plus à démarrer.

**Mise à jour** : `git pull` puis `node build.js` (ou `Mettre a jour GoofyTrack.bat`). Nouvelle empreinte de build : tous les joueurs d'une room doivent passer en V2.11.

## V2.10 : Goofy Coaster

Une piste pour s'amuser, dans la catégorie « Circuits » : un grand huit en boucle de 3,7 km, 60 m de dénivelé.

**Le tour**
- Départ en haut d'une tour, puis la grande descente : 45 m plus bas, la voiture dépasse 240 km/h.
- Le looping, 48 m de haut. La route fait un léger coude juste avant et juste après : une voiture qui suit la route traverse le looping sans toucher au volant.
- Une bosse, puis le premier saut : la route s'arrête net et reprend 3 m plus bas, sur une réception large.
- Le mur : un demi-tour de 65 m de rayon sur une route relevée à 72°.
- Le tire-bouchon : un tour et quart en montée, relevé à 68°, qui regagne 50 m.
- Trois vagues où les roues décollent, puis le saut du canyon : 26 m de vide, 5 m de chute.
- Le dos de chameau (20 m de creux puis une bosse) et un S relevé pour revenir au départ.
- Quatre points de contrôle, arrivée juste derrière la grille : la piste se joue aussi en course à plusieurs tours, avec collisions, et a son classement en ligne.

**Comment c'est fait**
- La piste n'est pas un assemblage de pièces : [`tools/make_stunt.js`](tools/make_stunt.js) la décrit comme une suite de mouvements (tout droit, virage, pente, dévers, looping, saut) suivis par un crayon dans l'espace, et en tire une route en dalle, sans rien dessous, qui peut passer au-dessus d'elle-même, se relever à la verticale et se retourner. Elle est posée sur des piliers.
- Elle a été mise au point hors du jeu, sur le moteur physique du jeu lui-même, avec un pilote automatique : il boucle le tour entre 140 et 240 km/h de vitesse maximale (1 min 05 à 1 min 40), et aussi pied au plancher, à près de 300 km/h, avec quelques touchettes.
- Ce que ces essais ont appris : une route relevée doit se remettre à plat lentement (sinon elle se dérobe sous les roues plus vite que la voiture ne peut pivoter), le virage doit se resserrer en même temps que la route se relève, et la largeur ne doit jamais changer d'un coup.

**À savoir en piste**
- Le mur et le tire-bouchon demandent de la vitesse : en dessous de 140 km/h environ, la voiture glisse vers le bas de la pente.
- Toucher un mur à grande vitesse peut arrêter net la voiture (le moteur physique accroche parfois sur les joints entre deux facettes).

**Mise à jour** : `git pull` puis `node build.js` (ou `Mettre a jour GoofyTrack.bat`). Nouvelle empreinte de build : tous les joueurs d'une room doivent passer en V2.10.

## V2.9 : Spa-Francorchamps, Strasbourg, Dijon

Trois circuits de plus dans la catégorie « Circuits », construits comme Montbéliard à partir de données réelles, et des outils communs pour en ajouter d'autres.

**Spa-Francorchamps**
- Le tracé du Grand Prix, à l'échelle : 7,00 km dans le jeu pour 7,004 km en vrai. La ligne vient du même relevé que Monaco GP ([`tools/spa_gps.json`](tools/spa_gps.json), projet f1-circuits, licence MIT). Départ sur la ligne de départ du Grand Prix, avant la Source ; sens horaire.
- Le relief est le vrai : les altitudes du tour et du terrain autour viennent du modèle européen EU-DEM (Copernicus), récupérées par [`tools/heights.js`](tools/heights.js). Le tour va de 368 m à 470 m d'altitude, soit 102 m de dénivelé : descente de la Source vers l'Eau Rouge, montée du Raidillon et de Kemmel jusqu'aux Combes, longue descente vers Stavelot, remontée par Blanchimont.
- Les pentes sont plafonnées à 9 % comme à Monaco GP (le Raidillon réel monte à 17 %) et les virages serrés sont remis presque à plat : sur une pente forte, la voiture perd son adhérence dans le jeu. Le dénivelé total, lui, est conservé.
- Décor : le terrain suit le relief réel et rejoint la route sur ses bords ; forêts plantées là où la carte en a (30 000 sapins), prairies ailleurs ; les stands F1 et Endurance, les tribunes, l'hôtel de la Source et les bâtiments du circuit sur leur emprise réelle, la voie des stands et les routes de service.
- La route garde ses glissières des deux côtés : les dégagements et les bacs à gravier ne sont pas reproduits.

**Strasbourg**
- Le tour de la Grande Île par les quais extérieurs, 4,0 km : quai Kléber, quai Sturm, place de la République, avenue de la Liberté, quai Koch, pont Royal, quai des Pêcheurs, quai des Bateliers, quai Saint-Nicolas, quai Finkwiller, Ponts Couverts, quai Turckheim, quai Saint-Jean. Le tracé emprunte aussi des quais aujourd'hui piétons ou réservés au tram.
- Ville : 4 600 bâtiments sur leur emprise réelle, l'Ill, le fossé du Faux-Rempart et les canaux de la Petite France. Façades blanches, crème et ocre sous des toits bruns très pentus.
- Monuments : la cathédrale Notre-Dame en grès rose avec sa flèche unique (142 m), les quatre tours des Ponts Couverts, Saint-Thomas, Saint-Paul et ses deux flèches, le palais Rohan, le palais du Rhin et son dôme, la Bibliothèque nationale universitaire, l'Opéra, l'Aubette, l'ancienne douane.
- Un bâtiment sur cinq a son nombre d'étages dans OpenStreetMap ; les autres sont estimés.

**Dijon**
- Le tour des boulevards de la vieille ville, 4,4 km : boulevard de la Trémouille, place de la République, boulevard Thiers, place du 30 Octobre, boulevard Carnot, rue de Tivoli, rempart de la Miséricorde, boulevard de Sévigné, place Darcy, boulevard de Brosses.
- Ville : 4 000 bâtiments sur leur emprise réelle, en pierre de Bourgogne.
- Monuments : le palais des Ducs et la tour Philippe le Bon (46 m), la cathédrale Saint-Bénigne avec son toit de tuiles vernissées et sa flèche de 93 m, Notre-Dame, Saint-Michel, Saint-Philibert, les halles, le théâtre, la porte Guillaume.
- Le circuit est à plat : le centre de Dijon ne varie que de quelques mètres.

**Outils**
- Les outils de Montbéliard deviennent communs et sont pilotés par [`tools/circuits.js`](tools/circuits.js), qui décrit chaque circuit (origine de la carte, points de passage ou relevé GPS, monuments, numéros de pièces) :
  - [`tools/town_osm.js`](tools/town_osm.js) réduit un extrait OpenStreetMap et trouve le tour sur les rues ;
  - [`tools/heights.js`](tools/heights.js) récupère les altitudes du tour et du terrain ;
  - [`tools/make_circuit.js`](tools/make_circuit.js) construit la route et le fichier du décor ;
  - [`tools/circuit_track.js`](tools/circuit_track.js) refait le fichier de piste dans le jeu.
- [`apex-town.js`](apex-town.js) remplace `apex-montbeliard.js` et dessine les quatre décors ; ce qui fait le style de chaque lieu (couleurs, pente des toits, monuments) est décrit en tête de fichier.
- Montbéliard est reconstruit par les outils communs à l'identique : même route, mêmes empreintes, même identifiant de piste, donc mêmes records.
- Chaque triangle de route coûte du temps au démarrage du jeu : les routes à plat (Strasbourg, Dijon) sont faites de grandes facettes, celle de Spa de facettes deux fois plus grandes que celles de Monaco GP (réglage `facets`). `apex-gfx.js` ne recalcule plus trois fois le lissage des mêmes routes.
- Un numéro de pièce de piste tient sur un octet : il reste de la place pour une vingtaine de circuits (numéros 149 à 235).

**Données** : plans © les contributeurs d'OpenStreetMap (ODbL) ; altitudes EU-DEM v1.1, produites avec des données Copernicus financées par l'Union européenne ; tracé de Spa du projet f1-circuits de Tomislav Bacinger (MIT).

**Mise à jour** : `git pull` puis `node build.js` (ou `Mettre a jour GoofyTrack.bat`). Nouvelle empreinte de build : tous les joueurs d'une room doivent passer en V2.9. Le dépôt grossit d'environ 10 Mo (routes et plans des trois circuits). Le jeu met quelques secondes de plus à démarrer : il prépare la route de chaque circuit au lancement.

## V2.8 : circuit de Montbéliard

Un deuxième circuit de ville dans la catégorie « Circuits », construit sur le vrai plan du centre de Montbéliard.

**Circuit**
- **Montbéliard**, 1,8 km, à l'échelle réelle : départ avenue des Alliés devant la gare, rue de l'Étuve, avenue du Maréchal de Lattre de Tassigny, rue Charles Contejean, avenue du Président Wilson le long de l'Allan, avenue d'Helvétie, puis avenue Aristide Briand au pied du château. Route de 15 m avec vibreurs et glissières, quatre points de contrôle, arrivée juste derrière la grille (courses en plusieurs tours possibles).
- Le tracé suit les vraies rues ; leurs angles droits sont arrondis en virages (rayon le plus serré : 21 m) et la route est plus large que les boulevards qu'elle emprunte. La ville étant plate à cet endroit, le circuit l'est aussi.
- Comme Monaco GP, le circuit a son classement en ligne sur le serveur GoofyTrack et fonctionne en room, collisions comprises.

**Ville** (`apex-montbeliard.js`, devenu [`apex-town.js`](apex-town.js) en V2.9)
- La ville n'est pas inventée : le plan vient d'[OpenStreetMap](https://www.openstreetmap.org/copyright). 1 900 bâtiments sont posés sur leur emprise réelle, avec les rues, les places, les parcs, l'Allan, le canal du Rhône au Rhin et les voies de la gare. Les 78 bâtiments qui se trouvaient sur la route élargie sont retirés.
- Façades aux couleurs de la vieille ville (ocre, rose, vert et bleu pâles) sous des toits de tuiles ; fenêtres sur les bâtiments proches de la route.
- Monuments : le château des ducs de Wurtemberg sur son rocher, avec ses deux tours rondes, le temple Saint-Martin, l'hôtel de ville, les halles, l'église Saint-Maimbœuf et ses deux clochers.
- Arbres dans les parcs et le long de l'Allan, tribunes là où la ville laisse de la place, collines boisées à l'horizon.
- OpenStreetMap donne les emprises mais presque jamais les hauteurs : le nombre d'étages est estimé d'après la taille de chaque bâtiment, et le rocher du château est modelé à la main.
- Le décor est seulement affiché, comme à Monaco : ce sont les glissières qui gardent les voitures sur la piste. Il compte environ 210 000 triangles, moitié moins que Monaco GP.

**Outils**
- `tools/montbeliard_osm.js` réduit un extrait OpenStreetMap du centre à ce qui sert ([`tools/montbeliard_osm.json`](tools/montbeliard_osm.json)) et calcule le tour sur les rues (depuis la V2.9 : `tools/town_osm.js`, réglages dans `tools/circuits.js`).
- `tools/make_montbeliard.js` en tire la route et les fichiers de [`tracks/montbeliard/`](tracks/montbeliard) ; il reprend le générateur de route de `tools/make_monaco.js`. `tools/montbeliard_track.js` refait le fichier de piste dans le jeu (depuis la V2.9 : `tools/make_circuit.js` et `tools/circuit_track.js`).
- Dans `patch_bundle.js`, les pièces de piste de Monaco et de Montbéliard sont déclarées par une même liste de circuits : en ajouter un troisième ne demande plus de nouveau patch.

**Données** : plan de la ville © les contributeurs d'OpenStreetMap, sous licence ODbL.

**Mise à jour** : `git pull` puis `node build.js` (ou `Mettre a jour GoofyTrack.bat`). Nouvelle empreinte de build : tous les joueurs d'une room doivent passer en V2.8.

## V2.7 : interface rouge, réglages des joueurs, mises à jour automatiques

**Interface**
- La couleur d'accent passe du vert citron au rouge GoofyTrack (`#f20d16`) : boutons principaux (Jouer, Appliquer, Lancer la course), barre de chargement, voyants des touches, flèche de la mini-carte. Le texte et les icônes sur ces boutons passent en blanc.
- Les curseurs des paramètres affichent leur valeur, de 0 à 100, à leur droite.

**Paramètres > Joueurs**
- Nouvelle section, après le son, pour les étiquettes au-dessus des autres voitures (fantômes, adversaires, fantôme de la room) : « Afficher l'UI des joueurs », « Montrer le nom », « Montrer le temps » et « Opacité de l'UI ». Quand l'UI des joueurs est coupée, les autres réglages de la section sont grisés.
- Les changements s'appliquent tout de suite, même en pleine partie (bouton Paramètres en jeu).
- Les textes de la section, et le nom de la mini-carte, sont traduits dans toutes les langues du jeu.

**Contre la montre**
- Les fantômes ont maintenant une étiquette comme en multijoueur : drapeau, pseudo et temps du record (votre drapeau pour votre propre fantôme). Elle s'efface avec la voiture quand le fantôme vous chevauche.

**Musique**
- « WAITING » de Teknah dans le menu de choix des pistes et sur la page d'une piste ; « Vroum Vroum » partout ailleurs, avec un fondu entre les deux.

**Mises à jour automatiques**
- [`update.js`](update.js), `Jouer a GoofyTrack.bat` et `Mettre a jour GoofyTrack.bat` : la dernière release est téléchargée et installée dans le jeu sans rien faire à la main (voir [Mises à jour automatiques](README.md#mises-à-jour-automatiques)).

**Mise à jour** : une dernière fois à la main (`git pull` ou nouveau ZIP, puis `node build.js`), ensuite `Jouer a GoofyTrack.bat` s'en charge. L'empreinte du build change, donc tous les joueurs d'une room doivent passer en V2.7.

## V2.6 : Monaco GP, environnement Riviera

**Circuit**
- Monaco est remplacé par **Monaco GP**, une copie du vrai circuit : le tracé vient des coordonnées GPS du Circuit de Monaco ([`tools/monaco_gps.json`](tools/monaco_gps.json)), à l'échelle réelle. 3,3 km : la ligne droite des stands, Sainte-Dévote, la montée de Beau Rivage, Massenet et le Casino, la descente vers Mirabeau, l'épingle du Fairmont, Portier, le tunnel, la chicane, Tabac, la Piscine, la Rascasse et Anthony Noghès.
- Le relief suit celui du circuit, un peu adouci : 35 m de montée entre Sainte-Dévote et la place du Casino (9 % au plus raide), puis la descente jusqu'au port. Il n'y a plus de pont : le vrai circuit ne se croise pas.
- Route de 15 m avec glissières des deux côtés, élargie à l'extérieur des virages serrés (jusqu'à 19 m dans l'épingle) pour laisser la place de tourner ; vibreurs rouges et blancs dans les virages, ligne blanche ailleurs. L'épingle et les deux branches de Mirabeau ont été un peu écartées pour que les glissières passent.
- Quatre points de contrôle (place du Casino, Portier, Tabac, Piscine), chacun sur une portion à plat, arrivée juste derrière la grille : compatible avec les courses en plusieurs tours.
- Les virages serrés (épingle, Mirabeau, Sainte-Dévote, chicane) sont presque à plat : la montée et la descente se font sur les portions droites, à 9 % au plus. La surface de la route est découpée finement, sans les petits plis qui secouaient la voiture dans les virages en pente.
- Les lignes peintes en travers de la route (départ, points de contrôle, arrivée) sont dessinées par le décor et ne font plus partie de la collision : la voiture ne rebondit plus dessus.
- Nouvel identifiant de piste : les records de l'ancien Monaco ne s'appliquent pas à Monaco GP.

**Décor**
- Principauté en low poly générée par [`apex-monaco.js`](apex-monaco.js) à partir du tracé : ville sur les pentes à la hauteur de la route, tours blanches à fenêtres bleues et couronne sombre, immeubles roses et jaunes, piscines sur les toits, maisons à toits de tuiles.
- Port Hercule entre la Piscine et le tunnel : pontons, environ 250 yachts amarrés en rangées, jetée nord et digue avec leur phare, enrochements.
- Les stands le long de la ligne droite (voie des stands, garages à toits rouges, rangée d'arbres), la passerelle verte au-dessus de la ligne droite, des tribunes bleues (ligne droite, Sainte-Dévote, Casino, chicane, Tabac, Piscine, Rascasse) et des grillages sur les glissières.
- La place du Casino : le Casino ocre à toit bleu, placé à l'écart de la route, ses deux tours à horloge et ses dômes, l'Hôtel de Paris, le jardin rond et sa fontaine.
- Le Fairmont au-dessus de l'entrée du tunnel, en gradins face à la mer, puis le tunnel continue en galerie ouverte côté mer.
- Le Rocher de Monaco-Ville au sud du port : falaises, vieille ville, palais princier et cathédrale. Collines en terrasses avec arbres ronds au nord, montagnes à l'horizon.
- Le sol du décor reste toujours sous la route : plus de « bosses » de terrain qui traversaient l'asphalte dans certains virages.
- Le décor apparaît aussi dans les replays.
- Le décor est construit en arrière-plan (un worker) dès le lancement du jeu : il est prêt quand on choisit la piste, et le jeu ne gèle plus pendant sa construction. Il est gardé pour les sessions suivantes. Les arbres des collines sont plus simples (environ 330 000 triangles au lieu de 410 000).

**Environnement Riviera**
- Quatrième bouton « Riviera » dans les réglages de la piste de l'éditeur, à côté d'Été, Hiver et Désert. La piste est enregistrée, exportée et partagée avec cet environnement comme avec les trois autres.
- Le fond de la piste devient une côte méditerranéenne ([`apex-scenery.js`](apex-scenery.js)) : collines de maquis, falaises calcaires, villages aux toits de tuiles, pins parasols et cyprès ; d'un côté de la piste, une baie avec sa plage, ses palmiers et la mer jusqu'à l'horizon, avec des yachts au mouillage. Plus de forêt de sapins ni de neige.
- Les pièces de piste et les ombres gardent les couleurs d'Été ; le sol est vert olive, avec une icône propre dans les listes de pistes.
- Les collines restent celles du jeu, qui servent aussi aux collisions ; du côté de la mer, elles sont dessinées plus basses, mais leur forme d'origine reste solide sous l'eau (on ne s'en approche qu'en sortant largement de la piste).
- Une piste Riviera n'existe que dans le mod : le jeu d'origine refuse de l'ouvrir.

**Outils**
- [`tools/make_monaco.js`](tools/make_monaco.js) n'a plus besoin du modèle 3D : il part du tracé GPS, l'arrondit, laisse la place aux glissières, ajoute le relief et place les points de contrôle.
- [`tools/monaco_track.js`](tools/monaco_track.js), à coller dans la console du jeu, produit le fichier de piste, son identifiant et sa miniature.

**Classements des circuits**
- Killer Loop et Monaco GP ont maintenant un classement en ligne, partagé entre tous les joueurs du mod. Le jeu l'affiche comme celui des pistes officielles : votre position dans la barre en haut à gauche, la liste des records sur la page de la piste, les fantômes à affronter et « Regarder » pour les replays.
- Ils sont tenus par le serveur GoofyTrack ([`server/records.js`](server/records.js)), et non par celui de PolyTrack qui ne connaît pas ces pistes. Les records faits avant cette version (restés sur votre machine) sont envoyés automatiquement à la première ouverture de la piste.
- Votre jeton PolyTrack n'est jamais envoyé au serveur GoofyTrack : un record est signé avec une clé tirée de ce jeton ([`apex-records.js`](apex-records.js)). Les autres pistes passent toujours par le classement officiel, sans changement.

**Menu principal**
- Nouveau logo GoofyTrack, et nouvelle icône du jeu dans la barre des tâches et Alt+Tab ([`images/goofytrack_icon.svg`](images/goofytrack_icon.svg), convertie en `.ico`).
- Sous le logo, « VERSION 2.6 » à la place de « GoofyTrack 2.6 ».
- Nouvelle musique : « Vroum Vroum » de Teknah.
- En bas, trois lignes : « "PolyTrack" Game Remastered by Julio & Shyn », « All Credits to © 2026 kodub.com », « Music : "Vroum Vroum" by Teknah ».
- Pistes officielles : la catégorie Circuits (Killer Loop, Monaco GP) passe en tête de liste, avant Été, Hiver et Désert. Auteur affiché : Julio.

**Contrôles**
- Les touches sont nommées d'après votre clavier : en AZERTY, Z / Q / S / D au lieu de W / A / S / D. Seuls les noms changent, les touches restent les mêmes.
- La mini-carte s'ouvre avec la touche M de votre clavier. En AZERTY, elle était sur la touche « , » (le M d'un clavier QWERTY) : elle passe sur M, sauf si vous aviez déjà changé cette touche.

**En jeu**
- Bouton **Paramètres** dans la barre en haut à gauche, dans tous les modes (solo, Casual, Compétitif, Course) : on change ses touches ou ses graphismes sans quitter la partie. Pendant que le menu est ouvert, la voiture ne réagit plus au clavier, et Échap ferme le menu sans quitter la piste.
- La barre en haut à gauche (Quitter, Regarder, nom de la piste et record) remonte dans le coin de l'écran.

**Corrections**
- Écran « Héberger », mode Course : la jauge du nombre de tours ne bougeait pas. Elle fonctionne, et les options sont espacées (nombre de tours au-dessus de la jauge, puis Qualifications et Tour de formation).
- Dans une room Course, les boutons − et + du nombre de tours ne répondaient pas : on était bloqué à la valeur choisie en créant la room.

**Mise à jour** : `git pull` puis `node build.js`. L'empreinte du build change (nouveau circuit, nouvel environnement), donc tous les joueurs d'une room doivent passer en V2.6. Le build modifie maintenant aussi l'éditeur du jeu (`112.bundle.js`). Le serveur doit être redéployé sur Render pour les classements, avec la variable `GITHUB_TOKEN` pour qu'ils survivent aux redémarrages (voir [Classements des circuits du mod](README.md#classements-des-circuits-du-mod)).

## V2.5 : nouveau Monaco, nouveau logo

**Monaco**
- Nouveau décor, entièrement généré par le mod ([`apex-monaco.js`](apex-monaco.js)) à partir du tracé du circuit : plus aucun modèle 3D ni texture extérieurs. La même ville est construite chez tous les joueurs, au chargement de la piste (environ une seconde).
- La mer au sud, avec un port : quais, pontons, yachts amarrés, une digue et son phare, quelques grands yachts au large.
- Une ville dense le long de la route : immeubles aux façades pastel, volets, commerces et auvents au rez-de-chaussée, tours plus haut sur la pente, villas sur les collines.
- Une place de casino avec jardins, fontaine, dôme et tourelles ; des tribunes le long de la ligne droite et face au port ; des palmiers en bord de mer et sur les boulevards.
- Un tunnel sous un hôtel, le long de la mer, à la place du tunnel de l'ancien décor. Les bâtiments, le tunnel et les tribunes projettent leur ombre sur la route.
- Les montagnes boisées sont remplacées, sur Monaco seulement, par des collines de maquis et des sommets de calcaire.
- Le circuit lui-même (route, vibreurs, glissières, points de contrôle) ne change pas : les temps restent comparables.
- L'ancien décor (`tracks/monaco/monaco_decor.bin` et `.jpg`, 4,8 Mo) est supprimé du dépôt et de l'installation.

**Mini-carte**
- Nouvelle touche « Mini-carte » pour l'afficher ou la masquer en pleine course : M par défaut, réglable dans Paramètres > Contrôles > Véhicule, sous « Caméra cockpit ». Le choix est gardé d'une partie à l'autre.
- M était aussi la deuxième touche de la caméra cockpit : la caméra garde C. Les touches enregistrées avant cette version sont reprises une fois de cette façon, ensuite vos réglages sont respectés.

**Interface**
- Nouveau logo GoofyTrack dans le menu principal ([`goofytrack-logo.svg`](goofytrack-logo.svg)) : lettres carrées penchées, bleu lavande cerné de bleu marine, traits de vitesse. Le thème ne le passe plus en niveaux de gris.

La V2.5 contient aussi le correctif des collisions de la V2.4.1.

**Mise à jour** : `git pull` puis `node build.js`. L'empreinte du build change (nouvelle version), donc tous les joueurs d'une room doivent passer en V2.5. Le décor de Monaco (`apex-monaco.js`) ne compte pas dans l'empreinte : il ne change que l'affichage.

## V2.4.1 : correctif des collisions

- **Correctif** : en V2.4 les voitures se traversaient la plupart du temps. Le mod retrouvait la voiture dans la mémoire du moteur physique grâce à trois copies de sa position, dont l'une n'est pas toujours identique aux autres au dernier chiffre près ; la recherche échouait alors et le choc n'était pas appliqué. La voiture est maintenant reconnue par les deux copies fiables et par d'autres champs du corps rigide.
- Les collisions sont actives en permanence dans une room « Course » : essais libres avant le lancement, qualifications, tour de formation et course. En V2.4 elles ne l'étaient que pendant le tour de formation et la course, donc pas tant que l'hôte n'avait pas lancé l'épreuve, ni en qualifications.
- Hors grille, tout le monde part du même point : une voiture à l'arrêt sur la ligne n'est pas solide, et une voiture qui démarre à l'intérieur d'une autre ne le devient qu'une fois dégagée.
- La mention « Collisions activées » s'affiche sous le classement de la room quand elles le sont.
- Une mise à jour de position arrivée en retard (après une plus récente) n'est plus prise pour un redémarrage de la voiture, ce qui la rendait traversable un instant.

**Mise à jour** : `git pull` puis `node build.js`. Nouvelle empreinte de build : tous les joueurs d'une room doivent passer en V2.4.1.

## V2.4 : collisions entre voitures

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

## V2.3 : circuit de Monaco

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

## V2.2.1 : correctif des invitations

**Corrections**
- Deux joueurs avec exactement la même version pouvaient être refusés dans la room de l'autre (« votre version de GoofyTrack n'est pas celle de l'hôte »). L'empreinte du build dépendait des fins de ligne des fichiers, que git peut convertir sous Windows selon les réglages de chacun (et qui diffèrent entre un clone et un ZIP). Elle est maintenant calculée sans en tenir compte.

**Mise à jour** : `git pull` (ou nouveau téléchargement du ZIP) puis `node build.js` chez **tous** les joueurs. L'empreinte change (`2.2.1-…`), et elle doit maintenant être la même pour tout le monde : comparez la ligne `build …` affichée par `node build.js`. Le serveur n'a pas besoin d'être mis à jour.

## V2.2 : décors, aides au pilotage, ambiances

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

## V2.1 : mise à jour des serveurs

Le multijoueur ne dépend plus des serveurs de PolyTrack.

**Serveur multijoueur GoofyTrack**
- Nouveau serveur de mise en relation dans [`server/`](server/server.js), qui remplace celui de PolyTrack pour héberger et rejoindre une room. La partie reste en pair-à-pair entre les joueurs ; les classements officiels passent toujours par les serveurs de PolyTrack.
- Codes d'invitation à 6 caractères (sans 0/O ni 1/I), valables tant que l'hôte est dans la room : plus d'expiration ni de renouvellement. Minuscules, espaces et tirets sont acceptés à la saisie.
- Déploiement gratuit sur Render avec [`render.yaml`](render.yaml) ; l'adresse du serveur se règle dans `SERVER_URL` de [`config.js`](config.js) (voir [Serveur multijoueur](README.md#serveur-multijoueur)).
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

## V2.0 : mode course

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

## V1.0 : première version

- Voiture de F1 : carrosserie complète, suspension animée, 16 livrées ; physique et forme de collision d'origine.
- Interface « Apex » : surfaces sombres translucides, coins arrondis, police Bahnschrift.
- Multijoueur : tableau des 5 meilleurs temps de la room et fantôme du meilleur tour.
- Code d'invitation renouvelé automatiquement à son expiration (remplacé en V2.1 par des codes sans expiration).
