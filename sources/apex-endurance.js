// Apex endurance: fuel, tyres and pit stops for the endurance tournaments (apex-room.js runs the event itself).
//
// Before the start every driver picks a strategy, so that not everybody starts with the same car:
//   big tank     more fuel, fewer stops, but the engine is held back (less acceleration, a lower top speed)
//   small tank   the full engine, but little fuel: more stops
//   tyres        a middle tank, brakes that never fade and tyres that wear much more slowly
// While racing, the throttle burns fuel and the distance, the braking and the cornering wear the tyres. Worn tyres
// turn and brake less; an empty tank leaves the car crawling. Stopping in the pit lane fills the tank, and staying
// there a few seconds puts new tyres on. The pit lane has a speed limiter.
//
// The physics (Bullet, compiled to WebAssembly) has no fuel nor tyre wear: as for the gravel traps (apex-sand.js), the
// controls of the car being driven are filtered before each physics step (1000 per second), in its physics worker:
// the throttle only works on some of the steps (the engine held back, or the tank empty), the steering and the brakes
// on fewer of them as the tyres wear, and the throttle is cut above a top speed (the pit limiter, the dry tank). The
// page works the fuel and the tyres out from the car's state, and tells the worker what to let through.
// Endurance laps are never records (apex-room.js), so filtering the controls changes no record.
//
// The same file is loaded by the page (index.html) and by the physics worker (importScripts, patch_bundle.js).
(() => {
  'use strict';

  const MESSAGE = 'apexEndurance';
  const CYCLE = 20;                  // steps: the pattern of what is let through repeats every 20 ms

  // ================================================================== physics worker
  if (typeof importScripts === 'function') {
    // the state the physics writes after each step: car id (4 bytes), frames (3), speed (4), flags (1), finish time
    // (3, only when finished), next checkpoint (2), then the position (3 floats) (as in apex-sand.js)
    const FLAGS = 11;
    let params = null;               // { throttle, steer, brake, vmax (m/s, 0: none) } or null: nothing filtered
    const cars = new Map();          // car id -> { x, y, z, speed }
    self.ApexEndurance = {
      message(data) {
        if (data == null || data.messageType !== MESSAGE) return false;
        params = data.on ? { throttle: +data.throttle || 0, steer: +data.steer || 0, brake: +data.brake || 0, vmax: +data.vmax || 0 } : null;
        return true;
      },
      controls(car, c) {
        if (params == null) return c;
        const s = cars.get(car.id), speed = s ? s.speed : 0, phase = car.frames % CYCLE;
        let up = c.up && phase < params.throttle * CYCLE;
        if (params.vmax > 0 && speed > params.vmax) up = false;
        const turn = (car.frames + 7) % CYCLE < params.steer * CYCLE;
        // under BRAKE_SPEED the brake key reverses the car: left alone
        const down = c.down && (speed < 5 || (car.frames + 13) % CYCLE < params.brake * CYCLE);
        return { up, right: c.right && turn, down, left: c.left && turn, reset: c.reset };
      },
      afterStep(M, car, ptr) {
        if (params == null) return;
        const u8 = M.HEAPU8, view = new DataView(u8.buffer, ptr, 64);
        const finished = (u8[ptr + FLAGS] & 2) !== 0, at = FLAGS + 1 + (finished ? 3 : 0) + 2;
        const x = view.getFloat32(at, true), y = view.getFloat32(at + 4, true), z = view.getFloat32(at + 8, true);
        let s = cars.get(car.id);
        if (s == null) cars.set(car.id, s = { x, y, z, speed: 0 });
        const moved = Math.hypot(x - s.x, y - s.y, z - s.z);
        s.speed = Number.isFinite(moved) && moved < 1 ? moved * 1000 : 0;   // m/s (a respawn jumps: not a speed)
        s.x = x; s.y = y; s.z = z;
      },
    };
    return;
  }

  // ================================================================== game page
  const french = () => String(window.apexLanguage || navigator.language || '').toLowerCase().startsWith('fr');
  const tr = (fr, en) => (french() ? fr : en);

  const BURN = 0.32;                 // litres per second at full throttle
  const IDLE_BURN = 0.02;            // litres per second off the throttle
  const RESERVE = 0.15;              // share of the tank: the warning
  const REFUEL = 6;                  // litres per second, stopped in the pits
  const TYRE_STOP = 4000;            // ms stopped in the pits for new tyres
  const STOPPED_KMH = 3;
  const PIT_LIMIT_KMH = 80;
  const TYRE_LIFE = 18000;           // metres on a set of tyres, before the wear multiplier (about 5.5 laps of Forest Speedway)
  const DRY_THROTTLE = 0.3, DRY_KMH = 60;   // an empty tank: the car crawls back to the pits
  const STRATEGIES = {
    big: { tank: 110, throttle: 0.9, wear: 1, brakes: false },
    small: { tank: 55, throttle: 1, wear: 1, brakes: false },
    tyres: { tank: 80, throttle: 0.95, wear: 0.45, brakes: true },
  };
  const DEFAULT_STRATEGY = 'tyres';
  const texts = () => ({
    big: { name: tr('Grand réservoir', 'Big tank'), info: tr('Plus d\'essence, moins d\'arrêts aux stands, mais un moteur bridé : moins de vitesse.', 'More fuel, fewer pit stops, but a held-back engine: less speed.') },
    small: { name: tr('Petit réservoir', 'Small tank'), info: tr('Le moteur à fond, plus de vitesse, mais peu d\'essence : plus d\'arrêts aux stands.', 'The full engine, more speed, but little fuel: more pit stops.') },
    tyres: { name: tr('Freins et pneus', 'Brakes and tyres'), info: tr('Réservoir moyen, freins qui ne faiblissent pas et pneus qui gardent leur adhérence bien plus longtemps.', 'A middle tank, brakes that never fade and tyres that keep their grip far longer.') },
  });
  // what the picker shows of each, out of 5
  const BARS = { big: { tank: 5, speed: 3, grip: 2 }, small: { tank: 2, speed: 5, grip: 2 }, tyres: { tank: 3, speed: 4, grip: 5 } };

  let car = null;                    // { strategy, fuel, wear, lastFrames, last, stoppedAt, pitTyres, status }
  let gauge = null, sent = null, sentAt = 0;
  let picker = null;

  const strategyOf = key => (Object.prototype.hasOwnProperty.call(STRATEGIES, key) ? key : DEFAULT_STRATEGY);
  const el = (parent, tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  };

  // ---------------------------------------------------------------- the worker of the car being driven
  function tell(p) {
    const worker = window.ApexSimWorker;
    if (worker == null) return;
    const key = p == null ? 'off' : [p.throttle, p.steer, p.brake, p.vmax].map(v => v.toFixed(2)).join(',');
    if (key === sent && performance.now() - sentAt < 1000) return;   // again now and then: a restart makes a new worker
    sent = key;
    sentAt = performance.now();
    worker.postMessage(p == null ? { messageType: MESSAGE, on: false } : { messageType: MESSAGE, on: true, ...p });
  }

  // ---------------------------------------------------------------- the race
  function start(strategy) {
    const s = STRATEGIES[strategyOf(strategy)];
    car = { strategy: strategyOf(strategy), fuel: s.tank, wear: 0, lastFrames: -1, last: null, stoppedAt: 0, pitTyres: false, status: null };
    sent = null;
  }
  function stop() {
    car = null;
    tell(null);
    sent = null;
    if (gauge != null) { gauge.remove(); gauge = null; }
  }

  // Every frame of the race, after the lights: state is the car's, pit(p) says where p is: 'box' (where the cars stop),
  // 'lane' (the rest of the pit lane) or null
  function frame(state, pit) {
    if (car == null) return;
    const s = STRATEGIES[car.strategy], kmh = Math.abs(state.speedKmh || 0);
    const dt = car.lastFrames < 0 ? 0 : state.frames - car.lastFrames;
    car.lastFrames = state.frames;
    const p = state.position, last = car.last;
    car.last = { x: p.x, y: p.y, z: p.z };
    const where = pit(p);
    // (frames can come slowly, a hidden window say: the race time gone by still counts, up to 2 s at once)
    if (dt > 0 && dt < 2000) {
      const c = state.controls || {};
      car.fuel = Math.max(0, car.fuel - (c.up ? BURN * s.throttle : IDLE_BURN) * dt / 1000);
      const metres = last ? Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) : 0;
      if (metres < Math.max(20, kmh / 3.6 * dt / 1000 * 2)) {          // more than that: a respawn, not a drive
        // cornering and braking at speed wear the tyres faster than rolling along
        const effort = 1 + (c.down && kmh > 60 ? 1.5 : 0) + ((c.left || c.right) && kmh > 120 ? 0.6 : 0);
        car.wear = Math.min(1, car.wear + metres * effort * s.wear / TYRE_LIFE);
      }
    }
    // the pit stop
    car.status = null;
    if (where === 'box' && kmh < STOPPED_KMH) {
      if (car.stoppedAt === 0) car.stoppedAt = performance.now();
      const stopped = performance.now() - car.stoppedAt;
      if (stopped > 600 && dt > 0 && dt < 2000) car.fuel = Math.min(s.tank, car.fuel + REFUEL * dt / 1000);
      if (stopped >= TYRE_STOP && !car.pitTyres) { car.wear = 0; car.pitTyres = true; }
      car.status = car.fuel < s.tank - 0.05 || !car.pitTyres
        ? tr('STAND · ravitaillement', 'PIT STOP · refuelling') + (car.pitTyres ? '' : '  ·  ' + tr('pneus', 'tyres') + ' ' + Math.max(0, Math.ceil((TYRE_STOP - stopped) / 1000)) + ' s')
        : tr('STAND · prêt, repartez !', 'PIT STOP · ready, go!');
    } else {
      car.stoppedAt = 0;
      if (where == null) car.pitTyres = false;
    }
    const inLane = where != null;
    if (inLane && car.status == null) car.status = tr('LIMITEUR STANDS', 'PIT LIMITER') + ' ' + PIT_LIMIT_KMH + ' km/h';
    const dry = car.fuel <= 0;
    if (car.status == null && dry) car.status = tr('PANNE SÈCHE · rentrez aux stands', 'OUT OF FUEL · back to the pits');
    else if (car.status == null && car.fuel < s.tank * RESERVE) car.status = tr('RÉSERVE · pensez aux stands', 'LOW FUEL · box soon');

    const grip = 1 - car.wear;
    tell({
      throttle: dry ? DRY_THROTTLE : s.throttle,
      steer: 1 - 0.35 * car.wear,
      brake: s.brakes ? 1 - 0.1 * car.wear : 1 - 0.45 * car.wear,
      vmax: (inLane ? PIT_LIMIT_KMH : dry ? DRY_KMH : 0) / 3.6,
    });
    renderGauge(s, grip);
  }

  function renderGauge(s, grip) {
    const ui = document.getElementById('ui');
    if (ui == null) return;
    if (gauge == null || !gauge.isConnected) {
      gauge = el(ui, 'div', 'apex-endurance-gauge');
      el(gauge, 'div', 'strategy');
      for (const kind of ['fuel', 'tyres']) {
        const row = el(gauge, 'div', 'meter ' + kind);
        el(row, 'span', 'label', kind === 'fuel' ? tr('Essence', 'Fuel') : tr('Pneus', 'Tyres'));
        el(el(row, 'span', 'bar'), 'span', 'fill');
        el(row, 'span', 'value');
      }
      el(gauge, 'div', 'status');
    }
    gauge.querySelector('.strategy').textContent = texts()[car.strategy].name;
    const fuel = car.fuel / s.tank;
    const set = (kind, share, text) => {
      const row = gauge.querySelector('.meter.' + kind);
      row.querySelector('.fill').style.width = Math.round(share * 100) + '%';
      row.querySelector('.value').textContent = text;
      row.classList.toggle('low', share < (kind === 'fuel' ? RESERVE : 0.35));
    };
    set('fuel', fuel, Math.round(car.fuel) + ' L');
    set('tyres', grip, Math.round(grip * 100) + ' %');
    const status = gauge.querySelector('.status');
    status.textContent = car.status || '';
    status.classList.toggle('on', !!car.status);
  }

  // ---------------------------------------------------------------- the strategy, before the start
  // onPick(key) as soon as a strategy is clicked (it can be changed until the start); null closes it
  function pick(chosen, onPick) {
    closePicker();
    const ui = document.getElementById('ui');
    if (ui == null) return;
    picker = el(ui, 'div', 'apex-endurance-picker');
    const box = el(picker, 'div', 'box');
    el(box, 'h2', null, tr('Choisissez votre stratégie', 'Pick your strategy'));
    el(box, 'p', 'hint', tr('Tout le monde ne part pas avec la même voiture : choisissez avant le départ. La course commence quand tous les pilotes ont choisi, ou quand l\'hôte la lance.',
      'Not everybody starts with the same car: pick before the start. The race starts once every driver has picked, or when the host starts it.'));
    const cards = el(box, 'div', 'cards');
    const names = texts();
    for (const key of Object.keys(STRATEGIES)) {
      const card = el(cards, 'button', 'card' + (key === chosen ? ' selected' : ''));
      el(card, 'div', 'name', names[key].name);
      el(card, 'div', 'info', names[key].info);
      for (const [bar, label] of [['tank', tr('Réservoir', 'Tank')], ['speed', tr('Vitesse', 'Speed')], ['grip', tr('Freins / pneus', 'Brakes / tyres')]]) {
        const row = el(card, 'div', 'stat');
        el(row, 'span', 'label', label);
        const pips = el(row, 'span', 'pips');
        for (let i = 0; i < 5; i++) el(pips, 'i', i < BARS[key][bar] ? 'on' : null);
      }
      el(card, 'div', 'litres', STRATEGIES[key].tank + ' L');
      card.addEventListener('click', () => {
        for (const c of cards.children) c.classList.toggle('selected', c === card);
        onPick(key);
      });
    }
    el(box, 'div', 'waiting');
  }
  function pickerStatus(text) { if (picker != null) picker.querySelector('.waiting').textContent = text || ''; }
  function closePicker() { if (picker != null) { picker.remove(); picker = null; } }

  const STYLE = `
#ui .apex-endurance-gauge {
  position: absolute; left: 16px; bottom: 120px; width: 240px; padding: 12px 14px; border-radius: var(--apx-r-md, 12px);
  background-color: var(--apx-glass, rgba(12,14,19,.72)); backdrop-filter: var(--apx-blur, blur(22px));
  box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255,255,255,.09)); font-family: var(--apx-font, sans-serif); color: var(--apx-fg, #f3f5f8); pointer-events: none;
}
#ui .apex-endurance-gauge .strategy { margin-bottom: 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--apx-accent, #f20d16); }
#ui .apex-endurance-gauge .meter { display: grid; grid-template-columns: 62px 1fr 52px; align-items: center; gap: 8px; margin: 5px 0; font-size: 13px; }
#ui .apex-endurance-gauge .meter .label { color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
#ui .apex-endurance-gauge .meter .bar { height: 8px; border-radius: 4px; background-color: var(--apx-fill-hover, rgba(255,255,255,.11)); overflow: hidden; }
#ui .apex-endurance-gauge .meter .fill { display: block; height: 100%; background-color: var(--apx-good, #4ff0a1); transition: width 0.3s linear; }
#ui .apex-endurance-gauge .meter.low .fill { background-color: var(--apx-bad, #ff5a6e); }
#ui .apex-endurance-gauge .meter .value { text-align: right; font-variant-numeric: tabular-nums; }
#ui .apex-endurance-gauge .status { display: none; margin-top: 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: var(--apx-warn, #ffd24a); }
#ui .apex-endurance-gauge .status.on { display: block; }
#ui .apex-endurance-picker {
  position: absolute; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; background-color: rgba(0,0,0,.35); pointer-events: none;
  font-family: var(--apx-font, sans-serif); color: var(--apx-fg, #f3f5f8);
}
#ui .apex-endurance-picker .box {
  width: min(900px, calc(100% - 32px)); padding: 22px 24px; border-radius: var(--apx-r-lg, 18px); background-color: var(--apx-glass-strong, rgba(12,14,19,.92));
  box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255,255,255,.09)), var(--apx-shadow, none); backdrop-filter: var(--apx-blur, blur(22px)); text-align: center;
  pointer-events: auto;   /* the room board stays usable around it: the host can start the race */
}
#ui .apex-endurance-picker h2 { margin: 0 0 6px; font-size: 22px; letter-spacing: 0.16em; text-transform: uppercase; }
#ui .apex-endurance-picker .hint { margin: 0 0 16px; font-size: 14px; color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
#ui .apex-endurance-picker .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
#ui .apex-endurance-picker .card {
  display: flex; flex-direction: column; gap: 8px; padding: 16px; border: none; border-radius: var(--apx-r-md, 12px); text-align: left; cursor: pointer;
  font-family: inherit; color: inherit; background-color: var(--apx-fill, rgba(255,255,255,.055)); box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255,255,255,.09)); pointer-events: auto;
}
#ui .apex-endurance-picker .card:hover { background-color: var(--apx-fill-hover, rgba(255,255,255,.11)); }
#ui .apex-endurance-picker .card.selected { background-color: var(--apx-accent-soft, rgba(242,13,22,.13)); box-shadow: inset 0 0 0 2px var(--apx-accent, #f20d16); }
#ui .apex-endurance-picker .card .name { font-size: 18px; font-weight: 700; }
#ui .apex-endurance-picker .card .info { min-height: 56px; font-size: 13px; line-height: 1.4; color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
#ui .apex-endurance-picker .card .stat { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
#ui .apex-endurance-picker .card .pips { display: flex; gap: 3px; }
#ui .apex-endurance-picker .card .pips i { width: 14px; height: 6px; border-radius: 2px; background-color: var(--apx-fill-hover, rgba(255,255,255,.11)); }
#ui .apex-endurance-picker .card .pips i.on { background-color: var(--apx-accent, #f20d16); }
#ui .apex-endurance-picker .card .litres { font-size: 13px; font-weight: 600; text-align: right; }
#ui .apex-endurance-picker .waiting { min-height: 18px; margin-top: 14px; font-size: 14px; color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
`;
  window.addEventListener('DOMContentLoaded', () => { document.head.appendChild(document.createElement('style')).textContent = STYLE; });

  window.ApexEndurance = {
    strategies: () => Object.keys(STRATEGIES),
    strategyName: key => texts()[strategyOf(key)].name,
    strategyOf,
    start, stop, frame,
    pick, pickerStatus, closePicker,
    debug: () => car && { ...car },
  };
})();
