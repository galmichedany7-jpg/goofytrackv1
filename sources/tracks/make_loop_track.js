// Builds the test circuit "Killer Loop": a closed rectangle of wide road (two cells, 33 m) where the
// finish line sits right behind the start, so a lap ends on the line the race starts from.
// Run it in the game's page from the developer console, it prints the track code to import:
//
//   paste the content of this file into the console, then: await KillerLoop.exportString()
//
// Grid: one cell is 4 units (20 m). Rotation r turns a part by r quarter turns; the local +x side of
// a part points to: r0 +x, r1 -z, r2 -x, r3 +z (local +z: r0 +z, r1 +x, r2 -z, r3 -x).
//   StartWide / FinishWide / CheckpointWide: road along local z, two cells wide (the part's own cell
//                                            and the one on its local +x side); rotation 0 starts towards -z.
//   StraightWide: half of a wide road along local z, wall on the local +x side.
//   OuterCornerWide: walls on the local -x and -z sides (the outside of a turn).
//   InnerCornerWide: only a post, at the local +x/+z corner (the apex of a turn).
// A wide 90° turn is a 2x2 block: outer corner, inner corner and two StraightWide halves.
(() => {
  let req;
  window.webpackChunk.push([[Symbol('killer-loop')], {}, r => { req = r; }]);
  const TrackData = req(9117).A;
  const P = { StraightWide: 10, InnerCornerWide: 11, OuterCornerWide: 12, CheckpointWide: 65, FinishWide: 74, StartWide: 91 };

  const CELL = 4;
  // Outer edge of the ring, in cells. The road is two cells wide: the start column is x = 0..1.
  const X0 = 0, X1 = 9, Z0 = -11, Z1 = 4;
  // StraightWide rotation for a wall facing each direction
  const WALL = { '+x': 0, '-z': 1, '-x': 2, '+z': 3 };

  function build(base) {
    const td = new TrackData(base.environment, base.sunDirection);
    const add = (cx, cz, id, rotation, extra = {}) =>
      td.addPart(cx * CELL, 0, cz * CELL, id, rotation, 0, 0, extra.checkpoint ?? null, extra.start ?? null);

    // Corners: outer cell, inner cell, then the two edge cells of the 2x2 block
    const corner = (ox, oz, ix, iz, rotation, edgeA, edgeB) => {
      add(ox, oz, P.OuterCornerWide, rotation);
      add(ix, iz, P.InnerCornerWide, rotation);
      add(...edgeA);
      add(...edgeB);
    };
    corner(X0, Z0, X0 + 1, Z0 + 1, 0, [X0 + 1, Z0, P.StraightWide, WALL['-z']], [X0, Z0 + 1, P.StraightWide, WALL['-x']]);
    corner(X1, Z0, X1 - 1, Z0 + 1, 3, [X1 - 1, Z0, P.StraightWide, WALL['-z']], [X1, Z0 + 1, P.StraightWide, WALL['+x']]);
    corner(X1, Z1, X1 - 1, Z1 - 1, 2, [X1 - 1, Z1, P.StraightWide, WALL['+z']], [X1, Z1 - 1, P.StraightWide, WALL['+x']]);
    corner(X0, Z1, X0 + 1, Z1 - 1, 1, [X0 + 1, Z1, P.StraightWide, WALL['+z']], [X0, Z1 - 1, P.StraightWide, WALL['-x']]);

    // Start column (driven towards -z): finish line (z = 1) just behind the start (z = 0)
    for (let z = Z1 - 2; z > Z0 + 1; z--) {
      if (z === 0) add(X0, z, P.StartWide, 0, { start: 0 });
      else if (z === 1) add(X0, z, P.FinishWide, 0);
      else { add(X0, z, P.StraightWide, WALL['-x']); add(X0 + 1, z, P.StraightWide, WALL['+x']); }
    }
    // Bottom and top rows (along x)
    for (let x = X0 + 2; x < X1 - 1; x++) {
      add(x, Z0, P.StraightWide, WALL['-z']); add(x, Z0 + 1, P.StraightWide, WALL['+z']);
      add(x, Z1, P.StraightWide, WALL['+z']); add(x, Z1 - 1, P.StraightWide, WALL['-z']);
    }
    // Far column with the checkpoint
    const mid = Math.round((Z0 + Z1) / 2);
    for (let z = Z0 + 2; z < Z1 - 1; z++) {
      if (z === mid) add(X1 - 1, z, P.CheckpointWide, 0, { checkpoint: 0 });
      else { add(X1 - 1, z, P.StraightWide, WALL['-x']); add(X1, z, P.StraightWide, WALL['+x']); }
    }
    return td;
  }

  window.KillerLoop = {
    async exportString() {
      const base = TrackData.fromExportString((await (await fetch('tracks/official/summer1.track')).text()).trim()).trackData;
      return build(base).toExportString({ name: 'Killer Loop', author: 'GoofyTrack' });
    },
    async build() {
      const base = TrackData.fromExportString((await (await fetch('tracks/official/summer1.track')).text()).trim()).trackData;
      return build(base);
    },
  };
})();
