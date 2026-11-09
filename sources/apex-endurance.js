// Apex endurance: fuel, tyres and pit stops for the endurance tournaments (apex-room.js runs the event itself).
//
// Before the start every driver sets up their car on three gauges sharing BUDGET points, so that not everybody
// starts with the same car (raising one lowers the others):
//   tank     more fuel, fewer stops
//   engine   more acceleration and a higher top speed, but it burns more
//   tyres    tyres that wear more slowly, and brakes that fade less as they do
// The curves (setupParams) are balanced on a model of a 15 minute race: every setup ends within a lap of the others.
// While racing, the throttle burns fuel and the distance, the braking and the cornering wear the tyres. Worn tyres
// turn and brake less; an empty tank leaves the car crawling. Each driver has a box of their own in the pit lane
// (apex-room.js draws it at random): stopping there fills the tank, and staying a few seconds puts new tyres on.
// The pit lane has a speed limit the drivers keep themselves: over it for more than OVER_GRACE in one visit, and the
// next stop in their box starts with a stop-and-go (the car held there STOP_GO longer). One still owed when the race
// ends costs PENALTY_MS on the result (apex-room.js).
//
// The physics (Bullet, compiled to WebAssembly) has no fuel nor tyre wear: as for the gravel traps (apex-sand.js), the
// controls of the car being driven are filtered before each physics step (1000 per second), in its physics worker:
// the throttle only works on some of the steps (the engine held back, or the tank empty), the steering and the brakes
// on fewer of them as the tyres wear, and the throttle is cut above a top speed (the dry tank, a stop-and-go). The
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
  const PIT_LIMIT_KMH = 100;          // in the pit lane, kept by the drivers themselves
  const OVER_GRACE = 2000;           // ms over it in one visit of the pit lane before a penalty
  const STOP_GO = 5000;              // ms the car is held in its box for a penalty, before the stop proper
  const PENALTY_MS = 10000;          // a penalty still owed at the end of the race, on the result (apex-room.js)
  const HOLD_KMH = 0.5;              // the throttle cut above this: the car held in its box
  const TYRE_LIFE = 18000;           // metres on a set of tyres, before the wear multiplier (about 5.5 laps of Forest Speedway)
  const DRY_THROTTLE = 0.3, DRY_KMH = 60;   // an empty tank: the car crawls back to the pits
  // the setup: three gauges of 0 to MAX points, BUDGET in all
  const AXES = ['tank', 'engine', 'tyres'], MAX = 10, BUDGET = 15;
  const DEFAULT_SETUP = { tank: 5, engine: 5, tyres: 5 };
  const SETUP_KEY = 'goofytrack.enduranceSetup';   // the last setup, for the next race (this browser only)
  // what the gauges do to the car: tank in litres, the share of the physics steps the throttle works on, fuel burnt
  // (x the base), tyre wear (x the base), how much the brakes fade as the tyres wear
  const setupParams = u => ({
    tank: 45 + 7 * u.tank,
    throttle: 0.86 + 0.014 * u.engine,
    burn: 0.8 + 0.05 * u.engine,
    wear: 1.2 - 0.09 * u.tyres,
    brakeFade: 0.45 - 0.035 * u.tyres,
  });
  // any setup made valid: whole points, 0 to MAX each, BUDGET in all (the points over or missing taken from or given to
  // the other gauges)
  function strategyOf(x) {
    const u = {};
    for (const a of AXES) { const v = x != null && typeof x === 'object' ? Math.round(+x[a]) : NaN; u[a] = Number.isFinite(v) ? Math.max(0, Math.min(MAX, v)) : DEFAULT_SETUP[a]; }
    let sum = AXES.reduce((t, a) => t + u[a], 0);
    while (sum !== BUDGET) {
      const step = sum > BUDGET ? -1 : 1, pick = AXES.filter(a => (step < 0 ? u[a] > 0 : u[a] < MAX)).sort((a, b) => step * (u[a] - u[b]))[0];
      u[pick] += step; sum += step;
    }
    return u;
  }
  const savedSetup = () => { try { return JSON.parse(localStorage.getItem(SETUP_KEY) || 'null'); } catch (e) { return null; } };
  // a short name for a setup, after the gauge it leans on
  const setupName = u => {
    const top = AXES.reduce((m, a) => (u[a] > u[m] ? a : m), AXES[0]);
    if (u[top] < 7) return tr('Équilibré', 'Balanced');
    return { tank: tr('Grand réservoir', 'Big tank'), engine: tr('Attaque', 'Attack'), tyres: tr('Pneus durs', 'Hard tyres') }[top];
  };

  let car = null;                    // { strategy (the setup), params (setupParams), fuel, wear, lastFrames, last, stoppedAt, pitTyres, status, inLane, over, flagged, penalties, servedAt }
  let gauge = null, sent = null, sentAt = 0;
  let picker = null;

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
    const u = strategyOf(strategy || savedSetup()), s = setupParams(u);   // not confirmed in time: the setup last shown
    car = { strategy: u, params: s, fuel: s.tank, wear: 0, lastFrames: -1, last: null, stoppedAt: 0, pitTyres: false, status: null, alert: false,
      inLane: false, over: 0, flagged: false, penalties: 0, servedAt: 0 };
    sent = null;
  }
  function stop() {
    car = null;
    tell(null);
    sent = null;
    if (gauge != null) { gauge.remove(); gauge = null; }
  }

  // Every frame of the race, after the lights: state is the car's, pit(p) says where p is in the pit lane: null (not in
  // it), or { zone: 'box' (in the driver's own box) or 'lane' (anywhere else in it), toBox: metres along the lane to
  // the driver's box (null: no box of their own, any box will do) }. box: the driver's box, { n, name, css } or null
  function frame(state, pit, box) {
    if (car == null) return;
    const s = car.params, kmh = Math.abs(state.speedKmh || 0);
    const dt = car.lastFrames < 0 ? 0 : state.frames - car.lastFrames;
    car.lastFrames = state.frames;
    const p = state.position, last = car.last;
    car.last = { x: p.x, y: p.y, z: p.z };
    const where = pit(p), zone = where ? where.zone : null, ticking = dt > 0 && dt < 2000;
    // (frames can come slowly, a hidden window say: the race time gone by still counts, up to 2 s at once)
    if (ticking) {
      const c = state.controls || {};
      car.fuel = Math.max(0, car.fuel - (c.up ? BURN * s.burn : IDLE_BURN) * dt / 1000);
      const metres = last ? Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) : 0;
      if (metres < Math.max(20, kmh / 3.6 * dt / 1000 * 2)) {          // more than that: a respawn, not a drive
        // cornering and braking at speed wear the tyres faster than rolling along
        const effort = 1 + (c.down && kmh > 60 ? 1.5 : 0) + ((c.left || c.right) && kmh > 120 ? 0.6 : 0);
        car.wear = Math.min(1, car.wear + metres * effort * s.wear / TYRE_LIFE);
      }
    }
    // the speed limit of the pit lane: OVER_GRACE over it in one visit, and a stop-and-go is owed
    const inLane = zone != null;
    if (inLane && !car.inLane) { car.over = 0; car.flagged = false; }
    car.inLane = inLane;
    if (inLane && kmh > PIT_LIMIT_KMH + 0.5 && ticking) {
      car.over += dt;
      if (car.over >= OVER_GRACE && !car.flagged) { car.flagged = true; car.penalties++; }
    }
    // the pit stop, in the driver's own box: the stop-and-go first, then fuel and tyres
    car.status = null;
    car.alert = false;
    let hold = false;
    if (zone === 'box' && kmh < STOPPED_KMH) {
      if (car.penalties > 0) {
        if (car.servedAt === 0) car.servedAt = performance.now();
        const served = performance.now() - car.servedAt;
        hold = true;
        car.alert = true;
        car.status = tr('STOP-AND-GO', 'STOP-AND-GO') + ' · ' + Math.max(0, Math.ceil((STOP_GO - served) / 1000)) + ' s';
        if (served >= STOP_GO) { car.penalties--; car.servedAt = 0; hold = car.penalties > 0; }
        car.stoppedAt = 0;
      } else {
        if (car.stoppedAt === 0) car.stoppedAt = performance.now();
        const stopped = performance.now() - car.stoppedAt;
        if (stopped > 600 && ticking) car.fuel = Math.min(s.tank, car.fuel + REFUEL * dt / 1000);
        if (stopped >= TYRE_STOP && !car.pitTyres) { car.wear = 0; car.pitTyres = true; }
        car.status = car.fuel < s.tank - 0.05 || !car.pitTyres
          ? tr('STAND · ravitaillement', 'PIT STOP · refuelling') + (car.pitTyres ? '' : '  ·  ' + tr('pneus', 'tyres') + ' ' + Math.max(0, Math.ceil((TYRE_STOP - stopped) / 1000)) + ' s')
          : tr('STAND · prêt, repartez !', 'PIT STOP · ready, go!');
      }
    } else {
      car.stoppedAt = 0;
      car.servedAt = 0;
      if (!inLane) car.pitTyres = false;
    }
    if (inLane && car.status == null) {
      if (car.flagged && car.over >= OVER_GRACE) { car.alert = true; car.status = tr('PÉNALITÉ · stop-and-go au prochain arrêt', 'PENALTY · stop-and-go at the next stop'); }
      else if (kmh > PIT_LIMIT_KMH + 0.5) { car.alert = true; car.status = tr('TROP VITE', 'TOO FAST') + ' · ' + PIT_LIMIT_KMH + ' km/h · ' + (Math.max(0, OVER_GRACE - car.over) / 1000).toFixed(1) + ' s'; }
      else {
        const to = where.toBox;
        car.status = tr('STANDS', 'PIT LANE') + ' ' + PIT_LIMIT_KMH + ' km/h' + (box && to != null ? '  ·  BOX ' + box.n + (to > 2 ? ' ' + tr('dans', 'in') + ' ' + Math.round(to) + ' m' : to < -2 ? ' ' + tr('dépassé', 'passed') : '') : '');
      }
    }
    const dry = car.fuel <= 0;
    if (car.status == null && dry) car.status = tr('PANNE SÈCHE · rentrez aux stands', 'OUT OF FUEL · back to the pits');
    else if (car.status == null && car.fuel < s.tank * RESERVE) car.status = tr('RÉSERVE · pensez aux stands', 'LOW FUEL · box soon');
    if (car.status == null && car.penalties > 0) { car.alert = true; car.status = tr('Stop-and-go à faire au stand', 'Stop-and-go to serve in the pits'); }

    const grip = 1 - car.wear;
    tell({
      throttle: dry ? DRY_THROTTLE : s.throttle,
      steer: 1 - 0.35 * car.wear,
      brake: 1 - s.brakeFade * car.wear,
      vmax: (hold ? HOLD_KMH : dry ? DRY_KMH : 0) / 3.6,
    });
    renderGauge(s, grip, box);
  }

  function renderGauge(s, grip, box) {
    const ui = document.getElementById('ui');
    if (ui == null) return;
    // over the speedometer (under it when the speedometer is at the top), else in a corner of its own
    const speedometer = ui.querySelector('.speedometer-ui');
    if (gauge != null && gauge.isConnected && speedometer != null && gauge.parentNode !== speedometer) speedometer.appendChild(gauge);
    if (gauge == null || !gauge.isConnected) {
      gauge = el(speedometer || ui, 'div', 'apex-endurance-gauge');
      el(gauge, 'div', 'strategy');
      for (const kind of ['fuel', 'tyres']) {
        const row = el(gauge, 'div', 'meter ' + kind);
        el(row, 'span', 'label', kind === 'fuel' ? tr('Essence', 'Fuel') : tr('Pneus', 'Tyres'));
        el(el(row, 'span', 'bar'), 'span', 'fill');
        el(row, 'span', 'value');
      }
      const own = el(gauge, 'div', 'box');
      el(own, 'span', 'label', tr('Votre box', 'Your box'));
      el(own, 'i', 'swatch');
      el(own, 'span', 'name');
      el(gauge, 'div', 'status');
    }
    gauge.querySelector('.strategy').textContent = setupName(car.strategy) + '  ·  ' + AXES.map(a => car.strategy[a]).join(' / ');
    const own = gauge.querySelector('.box');
    own.classList.toggle('on', box != null);
    if (box != null) { own.querySelector('.swatch').style.backgroundColor = box.css; own.querySelector('.name').textContent = box.n + ' · ' + box.name; }
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
    status.classList.toggle('alert', !!car.alert);
  }

  // ---------------------------------------------------------------- the setup, before the start
  // onPick(setup) once the driver confirms it, and again on every change after that (it can be changed until the start)
  function pick(chosen, onPick) {
    closePicker();
    const ui = document.getElementById('ui');
    if (ui == null) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SETUP_KEY) || 'null'); } catch (e) { saved = null; }
    let u = strategyOf(chosen || saved || DEFAULT_SETUP), confirmed = chosen != null;
    picker = el(ui, 'div', 'apex-endurance-picker');
    const box = el(picker, 'div', 'box');
    el(box, 'h2', null, tr('Réglez votre voiture', 'Set up your car'));
    el(box, 'p', 'hint', tr(BUDGET + ' points à répartir : monter une jauge baisse les autres. La course commence quand tous les pilotes ont validé, ou quand l\'hôte la lance.',
      BUDGET + ' points to share: raising a gauge lowers the others. The race starts once every driver has confirmed, or when the host starts it.'));
    const name = el(box, 'div', 'setup-name');
    const rows = {};
    const AXIS_TEXT = {
      tank: [tr('Réservoir', 'Tank'), tr('Plus d\'essence : moins d\'arrêts aux stands.', 'More fuel: fewer pit stops.')],
      engine: [tr('Moteur', 'Engine'), tr('Plus d\'accélération et de vitesse, mais il consomme plus.', 'More acceleration and speed, but it burns more.')],
      tyres: [tr('Pneus et freins', 'Tyres and brakes'), tr('Des pneus qui s\'usent moins vite, des freins qui tiennent.', 'Tyres that wear more slowly, brakes that hold on.')],
    };
    // what a gauge gives, in the car's own terms
    const effect = (a, q) => a === 'tank' ? Math.round(q.tank) + ' L'
      : a === 'engine' ? Math.round(q.throttle * 100) + ' %  ·  ' + tr('conso', 'burn') + ' ×' + q.burn.toFixed(2)
      : tr('usure', 'wear') + ' ×' + q.wear.toFixed(2);
    const gauges = el(box, 'div', 'gauges');
    for (const a of AXES) {
      const row = el(gauges, 'div', 'gauge ' + a);
      const head = el(row, 'div', 'head');
      el(head, 'span', 'label', AXIS_TEXT[a][0]);
      el(head, 'span', 'effect');
      const line = el(row, 'div', 'line');
      const minus = el(line, 'button', 'step', '−');
      const pips = el(line, 'div', 'pips');
      for (let i = 1; i <= MAX; i++) { const pip = el(pips, 'button', 'pip'); pip.addEventListener('click', () => set(a, i === u[a] ? i - 1 : i)); }
      const plus = el(line, 'button', 'step', '+');
      el(row, 'div', 'info', AXIS_TEXT[a][1]);
      minus.addEventListener('click', () => set(a, u[a] - 1));
      plus.addEventListener('click', () => set(a, u[a] + 1));
      rows[a] = row;
    }
    const go = el(box, 'button', 'confirm');
    go.addEventListener('click', () => { confirmed = true; send(); render(); });
    function send() {
      try { localStorage.setItem(SETUP_KEY, JSON.stringify(u)); } catch (e) { /* a private window: not kept */ }
      onPick({ ...u });
    }
    // a gauge set to v: the points it takes or gives back go to the other gauges, the fullest first when taking, the
    // emptiest first when giving
    function set(a, v) {
      v = Math.max(0, Math.min(MAX, v));
      const others = AXES.filter(b => b !== a);
      let delta = v - u[a];
      if (delta > 0) delta = Math.min(delta, others.reduce((t, b) => t + u[b], 0));
      if (delta < 0) delta = -Math.min(-delta, others.reduce((t, b) => t + MAX - u[b], 0));
      u[a] += delta;
      for (; delta > 0; delta--) { const b = others.filter(c => u[c] > 0).sort((x, y) => u[y] - u[x])[0]; u[b]--; }
      for (; delta < 0; delta++) { const b = others.filter(c => u[c] < MAX).sort((x, y) => u[x] - u[y])[0]; u[b]++; }
      try { localStorage.setItem(SETUP_KEY, JSON.stringify(u)); } catch (e) { /* a private window: not kept */ }
      if (confirmed) send();
      render();
    }
    function render() {
      const q = setupParams(u);
      name.textContent = setupName(u);
      for (const a of AXES) {
        rows[a].querySelector('.effect').textContent = effect(a, q);
        [...rows[a].querySelectorAll('.pip')].forEach((pip, i) => pip.classList.toggle('on', i < u[a]));
      }
      go.textContent = confirmed ? tr('Réglages envoyés ✓ (modifiables jusqu\'au départ)', 'Setup sent ✓ (can be changed until the start)') : tr('Valider ces réglages', 'Confirm this setup');
      go.classList.toggle('done', confirmed);
    }
    render();
    el(box, 'div', 'waiting');
  }
  function pickerStatus(text) { if (picker != null) picker.querySelector('.waiting').textContent = text || ''; }
  function closePicker() { if (picker != null) { picker.remove(); picker = null; } }

  const STYLE = `
#ui .apex-endurance-gauge {
  position: absolute; right: 16px; bottom: 120px; width: 240px; text-align: left; line-height: normal; padding: 12px 14px; border-radius: var(--apx-r-md, 12px);
  background-color: var(--apx-glass, rgba(12,14,19,.72)); backdrop-filter: var(--apx-blur, blur(22px));
  box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255,255,255,.09)); font-family: var(--apx-font, sans-serif); color: var(--apx-fg, #f3f5f8); pointer-events: none;
}
#ui .speedometer-ui > .apex-endurance-gauge { right: 0; bottom: calc(100% + 10px); box-sizing: border-box; }
#ui .speedometer-ui.up > .apex-endurance-gauge { bottom: auto; top: calc(100% + 10px); }
#ui .apex-endurance-gauge .strategy { margin-bottom: 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--apx-accent, #f20d16); }
#ui .apex-endurance-gauge .meter { display: grid; grid-template-columns: 62px 1fr 52px; align-items: center; gap: 8px; margin: 5px 0; font-size: 13px; }
#ui .apex-endurance-gauge .meter .label { color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
#ui .apex-endurance-gauge .meter .bar { height: 8px; border-radius: 4px; background-color: var(--apx-fill-hover, rgba(255,255,255,.11)); overflow: hidden; }
#ui .apex-endurance-gauge .meter .fill { display: block; height: 100%; background-color: var(--apx-good, #4ff0a1); transition: width 0.3s linear; }
#ui .apex-endurance-gauge .meter.low .fill { background-color: var(--apx-bad, #ff5a6e); }
#ui .apex-endurance-gauge .meter .value { text-align: right; font-variant-numeric: tabular-nums; }
#ui .apex-endurance-gauge .status { display: none; margin-top: 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: var(--apx-warn, #ffd24a); }
#ui .apex-endurance-gauge .status.on { display: block; }
#ui .apex-endurance-gauge .status.alert { color: var(--apx-bad, #ff5a6e); }
#ui .apex-endurance-gauge .box { display: none; align-items: center; gap: 8px; margin: 7px 0 2px; font-size: 13px; }
#ui .apex-endurance-gauge .box.on { display: flex; }
#ui .apex-endurance-gauge .box .label { width: 62px; color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
#ui .apex-endurance-gauge .box .swatch { width: 14px; height: 14px; border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.35); }
#ui .apex-endurance-gauge .box .name { font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
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
#ui .apex-endurance-picker .setup-name { margin: 0 0 14px; font-size: 13px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--apx-accent, #f20d16); }
#ui .apex-endurance-picker .gauges { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; text-align: left; }
#ui .apex-endurance-picker .gauge {
  display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: var(--apx-r-md, 12px);
  background-color: var(--apx-fill, rgba(255,255,255,.055)); box-shadow: inset 0 0 0 1px var(--apx-line, rgba(255,255,255,.09));
}
#ui .apex-endurance-picker .gauge .head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
#ui .apex-endurance-picker .gauge .label { font-size: 16px; font-weight: 700; }
#ui .apex-endurance-picker .gauge .effect { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
#ui .apex-endurance-picker .gauge .line { display: flex; align-items: center; gap: 8px; }
#ui .apex-endurance-picker .gauge .pips { flex: 1; display: grid; grid-template-columns: repeat(${MAX}, 1fr); gap: 3px; }
#ui .apex-endurance-picker .gauge .pip {
  height: 16px; padding: 0; border: none; border-radius: 3px; cursor: pointer; pointer-events: auto;
  background-color: var(--apx-fill-hover, rgba(255,255,255,.11));
}
#ui .apex-endurance-picker .gauge .pip.on { background-color: var(--apx-accent, #f20d16); }
#ui .apex-endurance-picker .gauge .step {
  width: 28px; height: 28px; padding: 0; border: none; border-radius: 50%; cursor: pointer; pointer-events: auto; font: inherit; font-size: 18px; line-height: 1;
  color: inherit; background-color: var(--apx-fill-hover, rgba(255,255,255,.11));
}
#ui .apex-endurance-picker .gauge .step:hover { background-color: var(--apx-accent-soft, rgba(242,13,22,.13)); }
#ui .apex-endurance-picker .gauge .info { min-height: 34px; font-size: 12px; line-height: 1.4; color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
#ui .apex-endurance-picker .confirm {
  margin-top: 16px; padding: 11px 22px; border: none; border-radius: var(--apx-r-md, 12px); cursor: pointer; pointer-events: auto;
  font: inherit; font-size: 15px; font-weight: 700; color: #fff; background-color: var(--apx-accent, #f20d16);
}
#ui .apex-endurance-picker .confirm.done { color: var(--apx-fg, #f3f5f8); background-color: var(--apx-fill-hover, rgba(255,255,255,.11)); }
@media (max-width: 700px) { #ui .apex-endurance-picker .gauges { grid-template-columns: 1fr; } }
#ui .apex-endurance-picker .waiting { min-height: 18px; margin-top: 14px; font-size: 14px; color: var(--apx-fg-muted, rgba(243,245,248,.62)); }
`;
  window.addEventListener('DOMContentLoaded', () => { document.head.appendChild(document.createElement('style')).textContent = STYLE; });

  window.ApexEndurance = {
    strategyName: u => setupName(strategyOf(u)),
    strategyOf,
    setupParams,
    start, stop, frame,
    penalties: () => (car ? car.penalties : 0),   // stop-and-gos still owed
    PENALTY_MS,
    pick, pickerStatus, closePicker,
    debug: () => car && { ...car },
  };
})();
