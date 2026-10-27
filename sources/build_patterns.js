// Generates the livery patterns for the F1 body: the game's 16, then the mod's (patch_bundle.js adds them to its list).
// Texture space (1024 x 1024): X follows the angle around the body (512 = centreline, sides further out),
// Y runs from the nose (0) to the tail (1024). Red = primary colour, green = secondary colour; the icons also have
// two inks no picker changes (patch_bundle.js, shade): blue, and black (none of the three), black and gold by
// default, each icon's own otherwise (ICONS there).
//
// Landmarks (Y): front wing 12-90, front axle 175, cockpit 410-580, sidepods 400-850, rear wing 885-1005.
// Landmarks (|X-512|): cockpit rim 85, tub side 180, sidepod top 200, sidepod flank 315, wing tips 440.
//
// Usage: node build_patterns.js [output dir]
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2] || path.join(require('./config').APP, 'images');

const G = '#0f0';
// the icons' inks and the primary colour, for a shape drawn in the secondary (paint)
const INK = '#00f', GOLD = '#000', P = '#f00';
// the same two inks on the R26, which has them navy and white (patch_bundle.js, ICONS)
const NAVY = INK, WHITE = GOLD;
const SERIF = "Georgia, 'Times New Roman', serif", BLACK = "'Arial Black', Arial, sans-serif";
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
  // Monaco GP Edition (GoofyTrack, legendary): the flag's split, primary above and secondary on the lower
  // flanks under a pinstripe, chequered wings and a chequered band behind the cockpit, the Grimaldi
  // lozenges down the nose
  monaco: sym(s => rect(s > 0 ? 767 : 0, 0, 257, 1024) + rect(X(s, 236) - 5, 0, 10, 1024))
    + checker(0, 1024, 12, 92, 27) + checker(257, 767, 612, 676, 32) + checker(0, 1024, 885, 1005, 40)
    + [215, 285, 355].map(y => poly([[512, y - 30], [536, y], [512, y + 30], [488, y]])).join(''),

  // ---- common and rare
  // A big racing number 8 on the nose, smaller ones on the sidepods
  bignumber: eight(512, 270, 1.6) + sym(s => eight(X(s, 290), 640, 1)),
  // One wide band across the car, nose left to tail right
  diagonal: poly([[0, 250], [0, 390], [1024, 870], [1024, 730]]),
  // Only the wing ends: front wing tips and rear wing endplates
  wingtips: sym(s => rect(s > 0 ? X(s, 330) : 0, 12, 182, 80) + rect(s > 0 ? X(s, 300) : 0, 885, 212, 120)),
  // A dotted line down the centre, nose to tail
  dotted: Array.from({ length: 16 }, (_, i) => rect(499, 18 + i * 63, 26, 34)).join(''),

  // ---- very rare and epic
  // Camouflage blobs all over
  camo: (() => { const r = rng(7); let out = ''; for (let i = 0; i < 80; i++) out += blob(r() * 1024, r() * 1024, 42 + r() * 45, r); return out; })(),
  // A lightning bolt down each flank
  lightning: sym(s => zigzag(i => X(s, i % 2 ? 300 : 205), i => 50 + i * 92, 10, 15)),
  // Hot-rod flames licking back from the nose
  flames: rect(0, 0, 1024, 140) + sym(s => [[0, 620], [95, 470], [185, 560], [270, 420], [355, 500], [440, 360]]
    .map(([d, tip]) => poly([[X(s, d - 48), 138], [X(s, d - 30), tip - 150], [X(s, d - 6), tip], [X(s, d + 12), tip - 170], [X(s, d + 46), 138]])).join('')),
  // Tiger stripes from the flanks, tapering towards the spine
  tiger: [130, 240, 350, 460, 570, 680, 790, 900].map((y, i) => sym(s => poly([[X(s, 512), y - 26], [X(s, 330), y - 8],
    [X(s, 110 + (i % 3) * 55), y + 24], [X(s, 320), y + 14], [X(s, 512), y + 24]]))).join(''),
  // A barcode across the engine cover
  barcode: (() => { const r = rng(3); let out = '', y = 560; while (y < 790) { const h = 4 + Math.floor(r() * 4) * 4; out += rect(0, y, 1024, h); y += h + 4 + Math.floor(r() * 3) * 4; } return out; })(),
  // Carbon weave: a fine lattice of small lozenges
  carbon: (() => { let out = ''; for (let r = 0; r < 33; r++) for (let c = 0; c < 33; c++) {
    const cx = c * 32 + (r % 2 ? 16 : 0), cy = r * 32; out += poly([[cx, cy - 11], [cx + 11, cy], [cx, cy + 11], [cx - 11, cy]]); } return out; })(),

  // ---- legendary: one edition per circuit of the mod
  // Spa: the Eau Rouge climb as a wave along each flank, raindrops on top (the Ardennes weather)
  spa: sym(s => ribbon(y => X(s, 330 + 85 * Math.sin(y / 1024 * Math.PI * 3)), 42, 0, 1024))
    + (() => { const r = rng(11); let out = ''; for (let i = 0; i < 34; i++) { const x = round(512 + (r() * 2 - 1) * 170), y = round(30 + r() * 960);
      out += `<ellipse cx="${x}" cy="${y}" rx="9" ry="11" fill="${G}"/>` + poly([[x - 8, y - 3], [x, y - 24], [x + 8, y - 3]]); } return out; })(),
  // Strasbourg: Alsatian half-timbering on the flanks, the cathedral's spire up the nose
  strasbourg: sym(s => {
    const x0 = Math.min(X(s, 262), X(s, 512));
    let out = rect(x0, 886, 250, 14);
    for (let y = 300, k = 0; y < 880; y += 117, k++) {
      out += rect(x0, y, 250, 12) + line(X(s, 262), y, X(s, 262), y + 117, 14);
      out += k % 2 ? line(X(s, 262), y, X(s, 512), y + 117, 12) + line(X(s, 512), y, X(s, 262), y + 117, 12) : line(X(s, 387), y, X(s, 387), y + 117, 12);
    }
    return out;
  }) + poly([[512, 30], [548, 330], [476, 330]]) + rect(470, 330, 84, 26) + rect(505, 360, 14, 40),
  // Dijon: a mustard band down the nose, the Burgundy glazed-tile lozenges on the flanks
  dijon: rect(456, 0, 112, 560) + sym(s => {
    let out = '';
    for (let r = 0; r < 11; r++) for (let c = 0; c < 6; c++) if ((r + c) % 2 === 0) {
      const cx = X(s, 250 + c * 48 + (r % 2 ? 24 : 0)), cy = 390 + r * 46;
      out += poly([[cx, cy - 24], [cx + 24, cy], [cx, cy + 24], [cx - 24, cy]]);
    }
    return out;
  }),
  // Montbeliard: the car factories' hazard stripes across the engine cover, a shield on the nose,
  // conveyor rollers along the flanks
  montbeliard: Array.from({ length: 18 }, (_, i) => poly([[i * 64 - 60, 600], [i * 64 - 26, 600], [i * 64 + 34, 720], [i * 64, 720]])).join('')
    + `<path d="M452 165 H572 V255 L512 335 L452 255 Z M472 185 V248 L512 302 L552 248 V185 Z" fill="${G}" fill-rule="evenodd"/>` + rect(504, 200, 16, 84)
    + sym(s => Array.from({ length: 12 }, (_, i) => `<circle cx="${X(s, 300)}" cy="${120 + i * 70}" r="22" fill="${G}"/>`).join('')
      + rect(Math.min(X(s, 268), X(s, 332)), 100, 64, 8) + rect(Math.min(X(s, 268), X(s, 332)), 900, 64, 8)),
  // Goofy Coaster: a pair of rails with their sleepers winding all over the car
  coaster: (() => {
    const fx = y => 512 + 300 * Math.sin(y / 1024 * Math.PI * 4);
    let out = ribbon(y => fx(y) - 46, 11, 0, 1024) + ribbon(y => fx(y) + 46, 11, 0, 1024);
    for (let y = 10; y < 1024; y += 40) out += line(fx(y) - 52, y, fx(y) + 52, y, 14);
    return out;
  })(),
  // Killer Loop: stripes spiralling around the body, like the loop
  killer_loop: [-3, -2, -1, 0, 1].map(k => poly([[k * 256, 0], [k * 256 + 96, 0], [k * 256 + 1120, 1024], [k * 256 + 1024, 1024]])).join(''),

  // ---- mythic
  // Goofy Signature: the GoofyTrack logo big on both sidepods and on the nose, the wings, a centre band
  goofy: sym(s => logo(X(s, 300), 640, s, 2)) + logo(512, 250, 0, 0.75) + rect(0, 12, 1024, 80) + rect(0, 885, 1024, 120)
    + rect(490, 390, 44, 495),
  // Champion: laurel wreaths on the nose and both sidepods, a centre band, chequered wings
  champion: laurels(512, 250, 120) + sym(s => laurels(X(s, 300), 640, 105)) + rect(484, 0, 56, 1024)
    + checker(0, 1024, 12, 92, 27) + checker(0, 1024, 885, 1005, 40),

  // ---- icons: real cars' liveries, which keep their white (the primary colour is locked), their sponsors made up
  // McLaren MP4/7A 1992: the red chevrons, one from behind the nose's lettering to the cockpit, one rising from
  // the floor to the gearbox; Malbarré on the sidepods, the nose and the rear wing, Pelle and its gold shovel low on
  // the flanks, POWERED by HONTA, COURT-JUS, BOSSE on the airbox, GOOFYEAR on the front wing, a red 1 on the nose
  mp4_7a: sym(s => poly([[X(s, 0), 255], [X(s, 90), 228], [X(s, 175), 190], [X(s, 210), 182], [X(s, 210), 392], [X(s, 160), 412], [X(s, 0), 470]])
      + poly([[X(s, 0), 885], [X(s, 120), 852], [X(s, 230), 752], [X(s, 330), 645], [X(s, 420), 588], [X(s, 512), 565], [X(s, 512), 1024], [X(s, 0), 1024]])
      + word('Malbarré', X(s, 190), 612, s, 250, 60, { font: SERIF })
      + word('POWERED by', X(s, 236), 548, s, 62, 11)
      + word('HONTA', X(s, 250), 642, s, 115, 24, { weight: 900 })
      + word('COURT-JUS', X(s, 288), 448, s, 95, 17)
      + shovel(X(s, 322), 520, s)
      + word('Pelle', X(s, 368), 520, s, 130, 30, { font: BLACK })
      + word('Malbarré', X(s, 118), 115, s, 150, 24, { font: SERIF })
      + word('GOOFYEAR', X(s, 435), 49, s, 78, 30, { font: BLACK, italic: true })
      + word('BOSSE', X(s, 46), 586, s, 36, 12)
      // the rear endplates' white square, a short circuit's bolt in it
      + paint(rect(Math.min(X(s, 140), X(s, 174)), 950, 34, 34), P)
      + paint(poly([[0.62, 0], [0.22, 0.55], [0.47, 0.55], [0.36, 1], [0.8, 0.4], [0.55, 0.4], [0.72, 0]].map(([u, v]) => [X(s, 145 + u * 24), 953 + v * 28])), INK))
    + `<path d="M0 0h3v20h-3v-15l-3 2v-3z" transform="translate(512 104) scale(11 -3)" fill="${G}"/>`
    + word('HONTA', 512, 140, 'nose', 70, 16, { weight: 900 })
    + paint(rect(362, 912, 300, 50), P) + word('Malbarré', 512, 937, 0, 250, 34, { font: SERIF }),
  // Renault R26 2006: blue (the primary colour), the yellow front with a blue band down the nose edged in white,
  // navy low on the nose and the bargeboards, a yellow band along the sidepods, white feathers over the engine
  // cover, navy wings; TEAM SPIROU on the front wing, the sidepods and the engine cover, elfe and HANJINX on the
  // flanks of the tub, RENAUD along the sidepods, Telefolica on the wings, i-moche low on the sidepods and the
  // rear endplates, MARELLE and a navy 1 on the nose
  r26: sym(s => poly([[X(s, 0), 0], [X(s, 512), 0], [X(s, 512), 470], [X(s, 250), 445], [X(s, 205), 432], [X(s, 0), 432]])
      + paint(poly([[X(s, 0), 140], [X(s, 20), 140], [X(s, 40), 230], [X(s, 66), 330], [X(s, 80), 432], [X(s, 0), 432]]), P)
      + paint(line(X(s, 21), 140, X(s, 41), 230, 7) + line(X(s, 41), 230, X(s, 67), 330, 7) + line(X(s, 67), 330, X(s, 81), 432, 7), WHITE)
      + paint(poly([[X(s, 70), 95], [X(s, 82), 175], [X(s, 160), 300], [X(s, 210), 420], [X(s, 255), 470], [X(s, 512), 500], [X(s, 512), 95]]), NAVY)
      // the front wing: blue, its endplates navy
      + paint(rect(Math.min(X(s, 138), X(s, 400)), 0, 262, 95), P) + paint(rect(Math.min(X(s, 400), X(s, 512)), 0, 112, 95), NAVY)
      // the yellow band along the sidepods, RENAUD in it
      + poly([[X(s, 150), 430], [X(s, 252), 430], [X(s, 238), 600], [X(s, 205), 760], [X(s, 176), 862], [X(s, 154), 862], [X(s, 166), 760], [X(s, 178), 600]])
      + word('RENAUD', X(s, 208), 560, s, 150, 30, { font: BLACK, colour: NAVY })
      // the white feathers over the engine cover and the sidepods
      + [[0, 0], [26, 42], [52, 84]].map(([dd, dy]) => `<path d="M${X(s, 38 + dd)} ${600 + dy}Q${X(s, 70 + dd)} ${700 + dy} ${X(s, 140 + dd)} ${770 + dy * 0.6}L${X(s, 128 + dd)} ${786 + dy * 0.6}Q${X(s, 60 + dd)} ${716 + dy} ${X(s, 30 + dd)} ${606 + dy}Z" fill="${WHITE}"/>`).join('')
      + word('TEAM SPIROU', X(s, 322), 655, s, 300, 52, { font: BLACK, colour: WHITE })
      + word('TEAM SPIROU', X(s, 48), 860, s, 120, 18, { font: BLACK, colour: WHITE })
      + word('TEAM SPIROU', X(s, 270), 52, 0, 190, 30, { font: BLACK, colour: WHITE })
      + word('Telefolica', X(s, 428), 50, s, 74, 26, { italic: true, colour: G })
      + word('elfe', X(s, 118), 245, s, 74, 38, { font: BLACK, colour: NAVY })
      + `<circle cx="${X(s, 118)}" cy="291" r="8" fill="${P}"/>`
      + word('HANJINX', X(s, 150), 368, s, 118, 26, { font: BLACK, colour: NAVY })
      + word('i-moche', X(s, 300), 470, s, 62, 20, { colour: G })
      + word('i-moche', X(s, 212), 945, s, 90, 26, { colour: G }))
    // the rear wing and the gearbox under it, navy, Telefolica across
    + paint(rect(212, 885, 600, 139), NAVY) + word('Telefolica', 512, 925, 0, 270, 44, { italic: true, colour: G })
    + paint(`<path d="M0 0h3v20h-3v-15l-3 2v-3z" transform="translate(512 108) scale(9 -2.6)" fill="${G}"/>`, NAVY)
    + word('MARELLE', 512, 128, 'nose', 56, 11, { colour: NAVY }),
};
// ---- shapes (function declarations: hoisted, used above)
function paint(svg, colour) { return svg.replace(/fill="#0f0"/g, `fill="${colour}"`); }
// a word centred at (x, y), w long and h high in texture pixels. On a flank (side s) it reads along the body, its top
// towards the spine (as logo()); on top (s = 0) it reads across, the right way round from the chase camera; on the
// nose (s = 'nose'), from in front of the car, as in the garage.
function word(text, x, y, s, w, h, { font = "Arial, sans-serif", colour = INK, weight = 'bold', italic = false } = {}) {
  const W0 = 60 * [...text].length;
  const turn = s === 'nose' ? 'scale(1 -1)' : s > 0 ? 'matrix(0 1 1 0 0 0)' : s < 0 ? 'matrix(0 -1 -1 0 0 0)' : 'scale(-1 1)';
  return `<text transform="translate(${x} ${y}) ${turn} scale(${(w / W0).toFixed(4)} ${(h / 72).toFixed(4)})" font-family="${font}" font-size="100" font-weight="${weight}"`
    + `${italic ? ' font-style="italic"' : ''} text-anchor="middle" dominant-baseline="central" textLength="${W0}" lengthAdjust="spacingAndGlyphs" fill="${colour}">${text}</text>`;
}
// Pelle's shovel: a gold blade in a red outline on a red handle, its handle towards the spine, like word()
function shovel(x, y, s) {
  const turn = s > 0 ? 'matrix(0 1 1 0 0 0)' : 'matrix(0 -1 -1 0 0 0)';
  const blade = 'M-34 -12H34V14Q34 46 0 50Q-34 46 -34 14Z';
  return `<g transform="translate(${x} ${y}) ${turn} scale(0.5 0.7)"><rect x="-6" y="-50" width="12" height="42" fill="${G}"/><rect x="-20" y="-50" width="40" height="9" fill="${G}"/>`
    + `<path d="${blade}" transform="scale(1.14)" fill="${G}"/><path d="${blade}" fill="${GOLD}"/></g>`;
}
// a chequered flag over a box: every other square, from its top left corner
function checker(x0, x1, y0, y1, size) {
  let s = '';
  for (let r = 0, y = y0; y < y1; r++, y += size) for (let c = 0, x = x0; x < x1; c++, x += size)
    if ((r + c) % 2 === 0) s += rect(x, y, Math.min(size, x1 - x), Math.min(size, y1 - y));
  return s;
}

// a seeded random number generator (mulberry32): the same patterns on every build
function rng(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function round(n) { return Math.round(n * 10) / 10; }
// an irregular blob around a point
function blob(cx, cy, r, random) {
  return poly(Array.from({ length: 9 }, (_, i) => { const a = i / 9 * Math.PI * 2, d = r * (0.65 + 0.5 * random()); return [round(cx + Math.cos(a) * d), round(cy + Math.sin(a) * d)]; }));
}
// a band of half-width w following x = fx(y), from y0 to y1
function ribbon(fx, w, y0, y1) {
  const left = [], right = [];
  for (let y = y0; y <= y1; y += 16) { left.push([round(fx(y) - w), y]); right.unshift([round(fx(y) + w), y]); }
  return poly(left.concat(right));
}
// a straight stroke of width w
function line(x1, y1, x2, y2, w) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / len * w / 2, ny = (x2 - x1) / len * w / 2;
  return poly([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]].map(p => p.map(round)));
}
// a zigzag through n points (x(i), y(i)), w thick
function zigzag(x, y, n, w) {
  let out = '';
  for (let i = 0; i < n - 1; i++) out += line(x(i), y(i), x(i + 1), y(i + 1), w) + `<circle cx="${x(i + 1)}" cy="${y(i + 1)}" r="${w / 2}" fill="${G}"/>`;
  return out;
}
// a racing number 8: two rings, k times the sidepods' size
function eight(cx, cy, k) {
  const ring = (y, rx, ry, t) => `M${cx - rx} ${y}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z M${cx - rx + t} ${y}a${rx - t} ${ry - t} 0 1 0 ${2 * (rx - t)} 0a${rx - t} ${ry - t} 0 1 0 ${-2 * (rx - t)} 0Z`;
  return `<path d="${ring(cy - 30 * k, 30 * k, 26 * k, 11 * k)} ${ring(cy + 22 * k, 34 * k, 30 * k, 11 * k)}" fill="${G}" fill-rule="evenodd"/>`;
}
// the GoofyTrack icon (images/goofytrack_icon.svg, drawn in 3..197 x 50..152) in one colour, k times its size.
// On a flank (side s) it reads along the body, its top towards the spine: the texture is mirrored there, hence a
// reflection; on top (s = 0) it reads across the body as seen from in front of the car, its top towards the cockpit.
function logo(cx, cy, s, k) {
  const icon = fs.readFileSync(path.join(__dirname, 'images', 'goofytrack_icon.svg'), 'utf8');
  const paths = [...icon.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map(m => `<path d="${m[1]}" fill="${G}"/>`).join('');
  const turn = s > 0 ? 'matrix(0 1 1 0 0 0)' : s < 0 ? 'matrix(0 -1 -1 0 0 0)' : 'scale(1 -1)';
  return `<g transform="translate(${cx} ${cy}) ${turn} scale(${k}) translate(-100 -101)">${paths}</g>`;
}
// a laurel wreath: leaves along two arcs, open at the top
function laurels(cx, cy, r) {
  let out = '';
  for (const side of [1, -1]) for (let i = 0; i < 9; i++) {
    const a = (100 + i * 18) * Math.PI / 180, x = round(cx + side * Math.cos(a) * r), y = round(cy + Math.sin(a) * r * 1.1);
    out += `<ellipse cx="${x}" cy="${y}" rx="${round(r / 3.6)}" ry="${round(r / 9)}" transform="rotate(${side * (i * 18 + 10)} ${x} ${y})" fill="${G}"/>`;
  }
  return out + rect(cx - 6, round(cy + r * 1.1 - 10), 12, 34);
}

for (const [name, shapes] of Object.entries(patterns)) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg width="1024" height="1024" version="1.1" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">\n <rect width="1024" height="1024" fill="#f00"/>\n ${shapes}\n</svg>\n`;
  fs.writeFileSync(path.join(OUT, `pattern_${name}.svg`), svg);
}
console.log(`Wrote ${Object.keys(patterns).length} patterns to ${OUT}`);
