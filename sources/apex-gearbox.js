// Apex gearbox: the engine's sound goes through the gears, as a real F1's does, rather than rising with the speed in
// one long crescendo. The revs climb in a gear, fall at each upshift (the ignition cut for a few hundredths of a
// second), climb again; lifting, they go down with the car, and braking the box shifts down early, each downshift
// blipping them back up, so the sound comes down in steps. The engaged gear is shown by the speedometer.
//
// Sound and display only: the game's physics knows no gears and is not touched (records and rooms stay as they are).
// The game calls window.ApexGearbox.engine() from its engine sound, every frame and for every car it plays, and
// window.ApexGearbox.hud() from its speedometer, with the player's car (patch_bundle.js).
(() => {
  'use strict';

  // km/h at the shift point, gear by gear (7 gears, as the F1s since 2004; 1st about the hairpins' speed)
  const GEARS = [100, 140, 178, 214, 248, 282, 315];
  const REVERSE = 60;           // km/h at the shift point in reverse
  const IDLE = 0.3;             // the revs at idle, against the shift point's
  const LAUNCH = 0.55;          // the revs held by the clutch, pulling away
  const UPSHIFT = 0.97;         // revs at which it shifts up, on the throttle
  const DOWN_BRAKING = 0.9;     // revs it would have in the gear below, under which it shifts down: braking,
  const DOWN_LIFTED = 0.68;     //   lifted,
  const DOWN_THROTTLE = 0.5;    //   on the throttle (a corner taken slowly in too high a gear)
  const SHIFT_GAP = 0.14;       // s between two shifts at least
  const CUT = 0.055;            // s of ignition cut at an upshift
  const PITCH_IDLE = 0.7;       // playbackRate at idle and at the shift point: the game's own range
  const PITCH_TOP = 2.0;
  const OVERREV = 0.25;         // past the shift point in top gear (a downhill, a booster), the revs still rise this much at most

  // A car's gearbox: { gear (0 neutral, -1 reverse), rpm (smoothed, 1 = shift point), shiftAt, cutUntil, blipUntil,
  // at (last step), soundAt (last step from the engine's sound), all in s }
  function box(car) {
    if (car.apxGearbox == null) car.apxGearbox = { gear: 0, rpm: IDLE, shiftAt: -1, cutUntil: -1, blipUntil: -1, at: -1, soundAt: -1 };
    return car.apxGearbox;
  }

  // the revs a gear gives at a speed (1 = its shift point)
  function revs(gear, kmh) {
    return kmh / (gear < 0 ? REVERSE : GEARS[gear - 1]);
  }

  // Moves a car's gearbox on to now. kmh: the car's speed; throttle: the engine pulling (the game's own "accelerating",
  // which counts reversing); braking; reversing; ground: a wheel on the ground; running: started and not finished.
  function step(g, { kmh, throttle, braking, reversing, ground, running }) {
    const now = performance.now() / 1000;
    const dt = g.at < 0 ? 0 : Math.min(0.1, now - g.at);
    g.at = now;
    kmh = Math.abs(kmh);

    // the gear
    if (!running) {
      if (kmh < 5) g.gear = 0;
      else if (g.gear <= 0) g.gear = 1;
    } else if (reversing) {
      g.gear = -1;
    } else if (g.gear <= 0) {
      if (g.gear < 0 && kmh > 3 && !throttle) {
        // still rolling backwards: stays in reverse
      } else {
        g.gear = 1;
        g.shiftAt = now;
      }
    }
    if (g.gear > 0 && ground && now - g.shiftAt > SHIFT_GAP) {
      const r = revs(g.gear, kmh);
      if (g.gear < GEARS.length && (throttle ? r >= UPSHIFT : r >= 1.02)) {
        g.gear++;
        g.shiftAt = now;
        if (throttle) g.cutUntil = now + CUT;
      } else if (g.gear > 1 && revs(g.gear - 1, kmh) < (braking ? DOWN_BRAKING : throttle ? DOWN_THROTTLE : DOWN_LIFTED)) {
        g.gear--;
        g.shiftAt = now;
        g.blipUntil = now + 0.09;
      }
    }

    // the revs the engine is driven to
    let target;
    if (g.gear === 0) target = throttle ? 0.8 : IDLE;
    else {
      target = revs(g.gear, kmh);
      if (target > 1) target = g.gear === GEARS.length || g.gear < 0 ? 1 + OVERREV * (1 - Math.exp(-(target - 1) / OVERREV)) : 1;
      if (throttle && g.gear === 1 && running) target = Math.max(target, LAUNCH);
      if (!ground) target = throttle ? Math.min(1, Math.max(target, LAUNCH) * 1.15) : target * 0.6;
      target = Math.max(IDLE, target);
    }
    // the limiter bouncing at the shift point, when it cannot shift up
    if (throttle && ground && target >= 0.995 && (g.gear === GEARS.length || g.gear < 0) && revs(g.gear, kmh) < 1.02) {
      target = 0.985 + 0.015 * Math.sign(Math.sin(now * 2 * Math.PI * 14));
    }
    if (now < g.cutUntil) target *= 0.97;
    // quick to rise, a little slower to fall, very quick at a shift (the clutch matching the revs to the wheels)
    const tau = now - g.shiftAt < 0.1 ? 0.03 : target > g.rpm ? 0.06 : 0.1;
    g.rpm = dt === 0 ? target : g.rpm + (target - g.rpm) * (1 - Math.exp(-dt / tau));

    const pitch = PITCH_IDLE + (PITCH_TOP - PITCH_IDLE) * (g.rpm - IDLE) / (1 - IDLE);
    // the game's loudness for its pitch, softer lifted, nearly silent through the cut, a little louder in a blip
    let gain = Math.min(0.285, pitch / 14) * (throttle ? 1 : 0.6);
    if (now < g.cutUntil) gain *= 0.25;
    else if (now < g.blipUntil) gain *= 1.15;
    return { pitch, gain, cutting: now < g.cutUntil };
  }

  function label(g) {
    return g.gear < 0 ? 'R' : g.gear === 0 ? 'N' : String(g.gear);
  }

  // ---------------------------------------------------------------- the gear by the speedometer
  let gearEl = null;
  function showGear(text) {
    const box = document.querySelector('#ui .speedometer-ui > .box');
    if (box == null) return;
    if (gearEl == null || gearEl.parentNode !== box) {
      gearEl = document.createElement('div');
      gearEl.className = 'apex-gear';
      box.insertBefore(gearEl, box.firstChild);
    }
    if (gearEl.textContent !== text) gearEl.textContent = text;
  }
  const style = document.createElement('style');
  style.textContent = `
#ui .speedometer-ui > .box { display: flex; align-items: stretch; justify-content: flex-end; }
#ui .speedometer-ui > .box > .apex-gear {
  margin: 0 8px 0 4px; padding: 0; min-width: 0.7em; align-self: center;
  line-height: 1; font-size: 34px; font-weight: 700; text-align: center;
  color: var(--text-color); opacity: 0.85;
}
`;
  document.head.appendChild(style);

  window.ApexGearbox = {
    GEARS,
    // From the engine's sound (this = the car): the sound to play, or null for the game's own
    // accelerating: the game's own; down: the brake key; ground; brakeLight
    engine(car, accelerating, down, ground, brakeLight) {
      try {
        const g = box(car);
        g.soundAt = performance.now() / 1000;
        return step(g, {
          kmh: car.getSpeedKmh(),
          throttle: accelerating,
          braking: down && brakeLight,
          reversing: down && !brakeLight && accelerating,
          ground,
          running: car.hasStarted() && !car.hasFinished(),
        });
      } catch (e) {
        return null;
      }
    },
    // From the speedometer, with the player's car
    hud(car) {
      try {
        if (car == null) return;
        const g = box(car);
        // no sound playing (sound off, or not yet loaded): the box moves on here
        if (!(performance.now() / 1000 - g.soundAt < 0.2)) {
          const { up, down } = car.getControls();
          const running = car.hasStarted() && !car.hasFinished();
          step(g, { kmh: car.getSpeedKmh(), throttle: running && up && !down, braking: down, reversing: false, ground: true, running });
        }
        showGear(label(g));
      } catch (e) { /* the gear is an extra: never in the game's way */ }
    },
  };
})();
