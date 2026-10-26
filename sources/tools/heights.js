// Fetches the real heights of a circuit and of the land around it: tools/<circuit>_heights.json.
//
//   node tools/make_circuit.js <circuit> --points     writes the lap's points (tools/<circuit>_points.json)
//   node tools/heights.js <circuit> [margin] [step]   asks for their heights, and for a grid of the land
//                                                     around the lap (margin and step in metres, 700 and 100)
//
// Heights come from the EU-DEM 25 m model of Copernicus, through the public API of opentopodata.org
// (100 points per request, one request a second). They are kept as metres above the lap's lowest point.
// EU-DEM is a surface model: in a forest it follows the treetops here and there, which shows as bumps of a
// few metres; the lap's profile is smoothed over about 150 m, and tools/make_circuit.js smooths it again.
const fs = require('fs');
const path = require('path');

const key = process.argv[2], margin = +process.argv[3] || 700, step = +process.argv[4] || 100;
const pointsFile = path.join(__dirname, key + '_points.json');
if (!key || !fs.existsSync(pointsFile)) { console.error('Usage: node tools/make_circuit.js <circuit> --points, then node tools/heights.js <circuit> [margin] [step]'); process.exit(1); }
const { origin, lap } = JSON.parse(fs.readFileSync(pointsFile, 'utf8'));
const DATASET = 'eudem25m';
const M_LAT = Math.PI / 180 * 6371000, M_LON = M_LAT * Math.cos(origin[1] * Math.PI / 180);
const toMetres = ([lon, lat]) => [(lon - origin[0]) * M_LON, -(lat - origin[1]) * M_LAT];
const toLonLat = ([x, z]) => [origin[0] + x / M_LON, origin[1] - z / M_LAT];

async function heightsOf(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const locations = points.slice(i, i + 100).map(p => p[1].toFixed(6) + ',' + p[0].toFixed(6)).join('|');
    let json = null;
    for (let attempt = 0; attempt < 4 && json == null; attempt++) {
      await new Promise(r => setTimeout(r, 1100));
      const res = await fetch('https://api.opentopodata.org/v1/' + DATASET + '?locations=' + locations, { headers: { 'User-Agent': 'GoofyTrack tools/heights.js' } });
      const body = await res.json().catch(() => null);
      if (body && body.status === 'OK') json = body; else console.log('retry', res.status, body && body.error);
    }
    if (json == null) throw new Error('The height service does not answer');
    for (const r of json.results) out.push(r.elevation);
    process.stdout.write(`\r${out.length}/${points.length} heights`);
  }
  process.stdout.write('\n');
  return out;
}

(async () => {
  const raw = await heightsOf(lap);
  // the lap: a moving average over 11 points (150 m), twice
  let h = raw.slice();
  for (let pass = 0; pass < 2; pass++) h = h.map((_, i) => { let s = 0; for (let o = -5; o <= 5; o++) s += h[(i + o + h.length) % h.length]; return s / 11; });
  const base = Math.min(...h);
  // the land: a square grid round the lap
  const m = lap.map(toMetres);
  const x0 = Math.floor((Math.min(...m.map(p => p[0])) - margin) / step) * step, z0 = Math.floor((Math.min(...m.map(p => p[1])) - margin) / step) * step;
  const cols = Math.ceil((Math.max(...m.map(p => p[0])) + margin - x0) / step) + 1, rows = Math.ceil((Math.max(...m.map(p => p[1])) + margin - z0) / step) + 1;
  const cells = []; for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) cells.push(toLonLat([x0 + i * step, z0 + j * step]));
  const land = await heightsOf(cells);
  const out = {
    source: 'Heights: EU-DEM v1.1, produced using Copernicus data and information funded by the European Union; fetched from opentopodata.org by tools/heights.js.',
    base: +base.toFixed(1),
    lap: h.map(v => +(v - base).toFixed(2)),
    grid: { x0, z0, step, cols, rows, h: land.map(v => +((v == null ? base : v) - base).toFixed(1)) },   // h[i * rows + j]
  };
  fs.writeFileSync(path.join(__dirname, key + '_heights.json'), JSON.stringify(out));
  console.log(`Lap from ${base.toFixed(0)} m to ${Math.max(...h).toFixed(0)} m above sea level; land grid ${cols} x ${rows} every ${step} m`);
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
