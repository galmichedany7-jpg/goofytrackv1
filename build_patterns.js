// Generates the 16 livery patterns for the F1 body.
// Texture space (1024 x 1024): X follows the angle around the body (512 = centreline, sides further out),
// Y runs from the nose (0) to the tail (1024). Red = primary colour, green = secondary colour.
//
// Landmarks (Y): front wing 12-90, front axle 175, cockpit 410-580, sidepods 400-850, rear wing 885-1005.
// Landmarks (|X-512|): cockpit rim 85, tub side 180, sidepod top 200, sidepod flank 315, wing tips 440.
//
// Usage: node build_patterns.js [output dir]
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2] || path.join(require('./config').APP, 'images');

const G = '#0f0';
const sym = fn => fn(1) + fn(-1); // mirror a shape on both sides of the centreline
const X = (s, d) => 512 + s * d;
const poly = pts => `<polygon points="${pts.map(p => p.join(',')).join(' ')}" fill="${G}"/>`;
const rect = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${G}"/>`;

const patterns = {
  // Classic centre stripe, nose to tail
  stripe: rect(484, 0, 56, 1024),
  // Twin racing stripes
  stripe2: sym(s => rect(X(s, 44) - 17, 0, 34, 1024)),
  // Flank stripes running along the sidepods and wing tips
  stripe3: sym(s => poly([[X(s, 215), 0], [X(s, 290), 0], [X(s, 290), 1024], [X(s, 215), 1024]])),
  // Wide centre band with pinstripes
  double_stripe: rect(470, 0, 84, 1024) + sym(s => rect(X(s, 66) - 6, 0, 12, 1024)),
  // Lower bodywork, floor edge and wing endplates
  edge: sym(s => poly([[X(s, 300), 0], [X(s, 512), 0], [X(s, 512), 1024], [X(s, 300), 1024]])),
  // Split livery
  half: rect(512, 0, 512, 1024),
  // Arrow sweeping back from the nose over the sidepods
  arrow: poly([[512, 0], [640, 330], [900, 700], [900, 860], [560, 520], [512, 470], [464, 520], [124, 860], [124, 700], [384, 330]]),
  // Number roundels on the nose and both sidepods
  circle: `<ellipse cx="512" cy="250" rx="62" ry="50" fill="${G}"/>` + sym(s => `<ellipse cx="${X(s, 285)}" cy="600" rx="78" ry="62" fill="${G}"/>`),
  // Engine cover and cockpit surround
  horseshoe: poly([[512, 395], [650, 430], [690, 560], [640, 1024], [384, 1024], [334, 560], [374, 430]]),
  // Tapered spear from the nose tip to the airbox
  needle: poly([[500, 0], [524, 0], [600, 420], [512, 640], [424, 420]]),
  // Rear half fading in as a wedge
  triangle: poly([[0, 1024], [0, 620], [512, 330], [1024, 620], [1024, 1024]]),
  // Harlequin diamonds
  diamonds: (() => {
    let s = '';
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const cx = c * 128 + (r % 2 ? 64 : 0), cy = r * 128;
      s += poly([[cx, cy - 64], [cx + 64, cy], [cx, cy + 64], [cx - 64, cy]]);
    }
    return s;
  })(),
  // Chevron bands across the body
  zigzag: [150, 420, 690].map(y => poly([[0, y + 150], [512, y], [1024, y + 150], [1024, y + 250], [512, y + 100], [0, y + 250]])).join(''),
  // Dots
  circles: (() => {
    let s = '';
    for (let r = 0; r < 12; r++) for (let c = 0; c < 9; c++)
      s += `<ellipse cx="${c * 128 + (r % 2 ? 64 : 0)}" cy="${r * 92 + 30}" rx="34" ry="27" fill="${G}"/>`;
    return s;
  })(),
  // Smooth fade from nose to tail
  gradient: `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.1" stop-color="#f00"/><stop offset="0.9" stop-color="#0f0"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#g)"/>`,
  // Contrasting wings with a thin body outline
  outline: rect(0, 0, 1024, 92) + rect(0, 884, 1024, 140) + sym(s => rect(X(s, 196) - 7, 92, 14, 792)),
};

for (const [name, shapes] of Object.entries(patterns)) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg width="1024" height="1024" version="1.1" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">\n <rect width="1024" height="1024" fill="#f00"/>\n ${shapes}\n</svg>\n`;
  fs.writeFileSync(path.join(OUT, `pattern_${name}.svg`), svg);
}
console.log(`Wrote ${Object.keys(patterns).length} patterns to ${OUT}`);
