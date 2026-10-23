// The outline of each circuit of the mod, as a small SVG path (24 x 24, north up like a map): drawn on the
// gold P1 badges (apex-account.js). build.js hands them to the game with the mod's tracks.
//
// The circuits keep their centre line in tracks/<name>/<name>.json ("fine": [x, z, ...] on the ground, with
// "north", the real north as a direction of the game's x, z); Goofy Coaster's is [x, y, z, ...] in 3D. Killer
// Loop has none: it is a plain rectangle of road (tracks/make_loop_track.js).
const fs = require('fs');
const path = require('path');

const SIZE = 24, PAD = 2.5, POINTS = 90;

// [x, y] points on screen (x right, y down) for a track, or null
function centreLine(track) {
  const key = path.basename(track.file, '.track');
  const file = path.join(__dirname, 'tracks', key, key + '.json');
  if (!fs.existsSync(file)) return key === 'killer_loop' ? [[0, 0], [9, 0], [9, 15], [0, 15]] : null;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data.fine) || data.fine.length < 3) return null;
  const ground = data.fine[0].length === 6 ? data.fine.map(p => [p[0], p[2]]) : data.fine.map(p => [p[0], p[1]]);
  // seen from above, the game's x is to the right and its z down; turned so that the real north is up
  const [nx, nz] = Array.isArray(data.north) ? data.north : [0, -1];
  return ground.map(([x, z]) => [x * -nz + z * nx, -(x * nx + z * nz)]);
}

function outline(track) {
  const line = centreLine(track);
  if (line == null) return null;
  const step = Math.max(1, Math.floor(line.length / POINTS));
  const pts = line.filter((_, i) => i % step === 0);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 || 1, h = Math.max(...ys) - y0 || 1;
  const k = (SIZE - 2 * PAD) / Math.max(w, h);
  const ox = (SIZE - w * k) / 2, oy = (SIZE - h * k) / 2;
  const r = v => Math.round(v * 10) / 10;
  return 'M' + pts.map(([x, y]) => r(ox + (x - x0) * k) + ' ' + r(oy + (y - y0) * k)).join('L') + 'Z';
}

module.exports = { outline };
