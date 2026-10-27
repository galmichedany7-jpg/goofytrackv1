// The circuits built from real places: where each one is and how its lap is found.
// tools/town_osm.js, tools/heights.js and tools/make_circuit.js take one of these keys.
//
//   mesh         prefix of the model's meshes (and of the part names declared by patch_bundle.js)
//   ids          the four track part ids: road, start, checkpoint, finish. A track file stores a part id in
//                one byte: 149 to 255 are free in PolyTrack 0.6.3 (240-243 are Monaco GP's)
//   origin       longitude and latitude of the map's origin; everything is in metres from it (x east, z south)
//   via, start   a lap on the streets: the points it goes through in turn, and where its start line is
//   walk         the lap may use pedestrian streets and bus lanes too
//   line         instead of via: a surveyed racing line (a file of this folder, { lonLat: [[lon, lat], ...] })
//   reach        how far from the lap the map is kept, in metres (everything when absent)
//   woods        forests are kept apart from the parks, to be planted as forests
//   landmarks    names on the map -> the name the town's scenery knows them by (see apex-town.js)
//   waterWidths  width of the rivers and canals mapped as lines, by name
//   smoothing, minRadius, gates, maxGrade, heightScale, facets   road builder settings (tools/make_circuit.js)
//   startHeight  how high above the start line the car appears (patch_bundle.js; 0.35 when absent)
module.exports = {
  montbeliard: {
    mesh: 'Montbeliard', ids: { road: 244, start: 245, checkpoint: 246, finish: 247 },
    origin: [6.7990, 47.5100], lonMetres: 75300,
    // the boulevards round the old town; the start line on Avenue des Alliés, in front of the station
    via: [[58, -210], [-316, -34], [-320, 184], [239, 83]], start: [150, -40],
    waterWidths: { "L'Allan": 30, 'Canal du Rhône au Rhin - Branche Sud': 18, 'La Lizaine': 7 },
    landmarks: { 'Château des Ducs de Wurtemberg': 'chateau', 'Temple Saint-Martin': 'temple', 'Halles de Montbéliard': 'halles', 'Hôtel de Ville de Montbéliard': 'mairie', 'Église Saint-Maimbœuf': 'eglise', 'Temple Saint-Georges': 'templeGeorges', 'Montbéliard': 'gare' },
  },
  strasbourg: {
    mesh: 'Strasbourg', ids: { road: 248, start: 249, checkpoint: 250, finish: 251 },
    origin: [7.7480, 48.5820], walk: true, facets: [1, 1],
    via: [[-345, -414], [305, -539], [753, -400], [560, 37], [40, 380], [-700, 60]], start: [0, -480],
    waterWidths: { "L'Ill": 32, "L'Ill Canalisé": 22, 'Fossé du Faux-Rempart': 22, 'Zornmühlkanal': 9, 'Düntzmühlkanal': 9, 'Spitzmühlkanal': 9, "L'Aar": 20, 'Canal de Dérivation': 16 },
    reach: 520,
    landmarks: { 'Cathédrale Notre-Dame': 'cathedrale', 'Palais Rohan': 'rohan', 'Palais du Rhin': 'palaisRhin', 'Opéra du Rhin': 'opera', 'Église Saint-Paul': 'saintPaul', 'Église protestante Saint-Thomas': 'saintThomas',
      'Hôtel de Ville': 'mairie', 'Barrage Vauban': 'vauban', 'Bibliothèque Nationale Universitaire de Strasbourg': 'bnu', 'Théâtre National de Strasbourg': 'tns', 'Palais de Justice': 'justice', 'Palais Universitaire': 'universite',
      'Ancienne douane': 'douane', 'Aubette': 'aubette', 'Église protestante Saint-Pierre-le-Jeune': 'saintPierre', 'Hans von Altheimturm': 'tour1', 'Tour des Français': 'tour2', 'Tour du Bourreau': 'tour3', 'Heinrichsturm': 'tour4' },
  },
  dijon: {
    mesh: 'Dijon', ids: { road: 252, start: 253, checkpoint: 254, finish: 255 },
    origin: [5.0415, 47.3220], walk: true, facets: [1, 1],
    via: [[263, -517], [655, -127], [510, 308], [-224, 571], [-640, 150], [-368, -294], [-148, -393]], start: [-192, -381],
    waterWidths: { "L'Ouche": 16, 'Canal de Bourgogne': 18 },
    reach: 520,
    landmarks: { 'Palais des Ducs et États de Bourgogne': 'palais', 'Cathédrale Saint-Bénigne': 'cathedrale', 'Église Notre-Dame': 'notreDame', 'Église Saint-Michel': 'saintMichel', 'Halles Centrales': 'halles',
      'Théâtre Municipal': 'theatre', 'Église Saint-Philibert': 'saintPhilibert', 'Préfecture de la Côte-d’Or': 'prefecture', 'Hôtel des Postes': 'poste', 'Porte Guillaume': 'porteGuillaume', 'Tour Philippe Le Bon': 'tourPhilippe' },
  },
  spa: {
    mesh: 'Spa', ids: { road: 236, start: 237, checkpoint: 238, finish: 239 },
    origin: [5.9690, 50.4370], woods: true,
    line: 'spa_gps.json', startLonLat: [5.96510, 50.44420],
    smoothing: 6, minRadius: 19, reach: 900, facets: [4, 2],
    landmarks: { 'Stand F1': 'pitsF1', 'Stand Endurance': 'pitsEndurance', 'Hôtel de la Source': 'hotelSource' },
  },
  // not a place on a map either: a Grand Prix circuit drawn by hand in a forest (tools/forest_design.js writes its
  // line, gravel traps, grid and surroundings in the files the map tools would have made)
  forest: {
    mesh: 'Forest', ids: { road: 228, start: 229, checkpoint: 230, finish: 231 },
    origin: [0, 0], line: 'forest_line.json', startLonLat: [0, 0],
    roadHalf: 9,                     // 18 m of asphalt, room to overtake
    smoothing: 2, minRadius: 18, facets: [1, 1],
    heightPasses: 1, maxGrade: 0.11,                 // its heights are drawn already: hardly smoothed
    gates: [[0.43, 0.47], [0.575, 0.605], [0.876, 0.886]],   // on straights, away from the gravel; the last one just past the bridge
    terrain: { hills: 70 },
    startHeight: 0.13,               // the car appears resting on the road (patch_bundle.js)
  },
  // not a place on a map: a stunt track drawn by tools/make_stunt.js (loop, jumps, wall ride, corkscrew).
  // It is listed here for its part ids and mesh names; the map tools do not apply to it.
  coaster: { mesh: 'Coaster', ids: { road: 232, start: 233, checkpoint: 234, finish: 235 }, stunt: true },
};
