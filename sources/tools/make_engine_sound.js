// Makes the bodies' engine sounds (patch_bundle.js, ENGINE_SOUNDS), made up here, into audio/engine_<name>.wav. The
// game loops them and speeds them up with the car (playbackRate 0.7 at a standstill, about 2 flat out), as it does
// its own engine.ogg, whose loudness they match (RMS about 0.3). Each is lines UNIT apart (PROFILE, in dB under the
// loudest, the FIRE-th), over a breath of noise between the lines beating with the firing; no two firings are quite
// as loud and the revs drift a little. Every frequency is a whole number of cycles in the loop, so it loops without
// a click.
//
// mp4_7a, the MP4/7A body's V12: its spectrum copies the one measured on an onboard recording of the Honda RA122E in
// Senna's MP4/7A (Kyalami 1992, flat out on the straight; the recording itself is not part of the mod): lines every
// 112 Hz, the 6th (676 Hz) the loudest, then the 3rd, 8th, 12th and 15th, every 3rd one strong, the 1st, 5th, 10th
// and 13th faint, over a third of the sound being breath. Here the lines are UNIT apart, so that flat out (about x2)
// it sings at the real car's pitch.
//
// r26, the R26 body's V8 (the Renault RS26, 2.4 litres, flat-plane): its spectrum copies the one measured on an
// onboard recording of the R26 (2006, the flat-out plateaus of a lap, 110 to 300 s in; not part of the mod either):
// lines every 148 Hz (half orders of the revs, about 17 700 rpm), the 4th (2 a turn, 590 Hz) far the loudest, the
// 8th (the firing, 4 a turn) and 10th next, the 3rd and 2nd under them; above 1.6 kHz hardly any lines, a breath
// over half the sound, at its strongest from 400 to 800 Hz and losing about 6 dB an octave above. Darker than the
// V12, a hum with a growl rather than a scream.
//
//   node tools/make_engine_sound.js [name...]   (all of them by default)
const fs = require('fs');
const path = require('path');

const RATE = 44100, SECONDS = 2, N = RATE * SECONDS;
const RMS = 0.3;

const ENGINES = {
  mp4_7a: {
    UNIT: 56,       // Hz between the lines: the loudest at 336 Hz, about 235 Hz at a standstill and 670 Hz flat out
    FIRE: 6,        // the loudest line, the firing
    NOISE: 0.75,    // the breath's share, against the lines (the recording: about a third of the sound)
    SEED: 92,
    SHAKE: 0.4,     // how much one firing's strength differs from the next
    KNEE: 0.7,      // where the limiter starts rounding the peaks off
    // dB under the 6th line, line by line from the 1st (measured, 68.4 to 71.3 s into the recording)
    PROFILE: [-22, -18, -7, -13, -20, 0, -13, -8, -13, -20, -17, -9, -23, -20, -10, -24, -24, -18, -27, -25, -21, -28, -25, -21,
      -29, -27, -24, -28, -29, -25, -25, -26, -25, -28, -32, -30, -29, -32, -26, -30, -28, -31, -30, -33, -28, -32, -35, -30, -35, -35,
      -28, -35, -35, -33, -34, -39, -38, -36, -35, -37],
    BREATH: [0.12, 0.2, 0.028],   // the breath's low-passes, then the one taken off under it
  },
  r26: {
    UNIT: 74,       // Hz between the lines: the loudest at 296 Hz, about 207 Hz at a standstill and 590 Hz flat out
    FIRE: 4,
    NOISE: 1,       // the recording: 54% breath, a little less here
    SEED: 26,
    SHAKE: 0.4,
    KNEE: 0.7,
    // dB under the 4th line, from the 1st (measured; from the 11th on, 4 dB under it: the breath there was as loud
    // as the lines)
    PROFILE: [-23, -14, -11, 0, -14, -14, -16, -7, -13, -10, -22, -20, -22, -25, -25, -25, -25, -26, -25, -25, -26, -29, -29, -29,
      -31, -32, -32, -34, -35, -36, -36, -35, -37, -37, -37, -37, -38, -39, -39, -39, -41, -41, -42, -43, -43, -44, -43, -43],
    BREATH: [0.09, 0.17, 0.012],
  },
};

function make(name, { UNIT, FIRE, NOISE, SEED, SHAKE, KNEE, PROFILE, BREATH }) {
  const OUT = path.join(__dirname, '..', 'audio', `engine_${name}.wav`);
  // a seeded random number generator (mulberry32): the same sound on every run
  let seed = SEED;
  const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const phases = PROFILE.map(() => random() * 2 * Math.PI);

  // a one-pole low-pass of k (0..1) over a loop, run twice round it so its end joins its start
  function lowPass(x, k) {
    let y = 0;
    const out = new Float32Array(x.length);
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); if (pass === 1) out[i] = y; }
    return out;
  }
  // the breath: noise from about 200 Hz, falling away above the low-passes (the V12's from 1 kHz), as between the
  // recording's lines
  const white = Float32Array.from({ length: N }, () => random() * 2 - 1);
  const under = lowPass(lowPass(white, BREATH[0]), BREATH[1]), floor = lowPass(under, BREATH[2]);
  const noise = under.map((v, i) => v - floor[i]);

  // each firing's own strength (the loudest line's cycles), eased from one to the next
  const FIRINGS = FIRE * UNIT * SECONDS;
  const strength = Array.from({ length: FIRINGS }, () => 1 - SHAKE / 2 + SHAKE * random());
  const strengthAt = f => { const j = Math.floor(f), u = f - j, e = (1 - Math.cos(Math.PI * u)) / 2; return strength[j % FIRINGS] * (1 - e) + strength[(j + 1) % FIRINGS] * e; };

  const lines = new Float32Array(N), breath = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / RATE;
    // the revs drifting by about 0.5%: time running a little faster, then slower (whole cycles in the loop)
    const w = t + 0.0006 * Math.sin(2 * Math.PI * 1.5 * t) + 0.0002 * Math.sin(2 * Math.PI * 4 * t);
    let v = 0;
    PROFILE.forEach((db, n) => { v += 10 ** (db / 20) * Math.sin(2 * Math.PI * (n + 1) * UNIT * w + phases[n]); });
    const f = FIRE * UNIT * w, firing = 0.5 - 0.5 * Math.cos(2 * Math.PI * f), s = strengthAt(f);
    lines[i] = v * (0.85 + 0.15 * s);
    breath[i] = noise[i] * s * (0.4 + 0.6 * firing);
  }
  const rmsOf = x => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length);
  const ln = rmsOf(lines), br = rmsOf(breath);
  const out = lines.map((v, i) => v / ln * Math.sqrt(1 - NOISE ** 2 / (1 + NOISE ** 2)) + breath[i] / br * NOISE / Math.sqrt(1 + NOISE ** 2));
  // to the loudness wanted, the rare peaks above KNEE rounded off under 1 (a soft limiter: the rest stays untouched)
  const room = 0.99 - KNEE;
  const limit = v => (Math.abs(v) < KNEE ? v : Math.sign(v) * (KNEE + room * Math.tanh((Math.abs(v) - KNEE) / room)));
  const level = rmsOf(out);
  for (let i = 0; i < N; i++) out[i] = limit(out[i] * RMS / level);
  const rms = rmsOf(out), peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

  // 16-bit mono PCM
  const wav = Buffer.alloc(44 + N * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 2, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(N * 2, 40);
  for (let i = 0; i < N; i++) wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(OUT, wav);
  console.log(`Wrote ${OUT} (${SECONDS} s, RMS ${rms.toFixed(2)}, peak ${peak.toFixed(2)})`);
}

const names = process.argv.slice(2);
for (const name of names.length ? names : Object.keys(ENGINES)) make(name, ENGINES[name]);
