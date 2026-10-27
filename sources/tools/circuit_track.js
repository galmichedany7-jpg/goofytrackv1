// Builds the track file of a circuit from tracks/<circuit>.json (written by tools/make_circuit.js), in the game.
// Run it in the game's page (node serve.js, then the developer console), after a build with the new parts:
//
//   paste the content of this file into the console, then: await CircuitTrack.make('montbeliard', 'Montbéliard', 'Shyn')
//
// It returns what tracks/ needs: the track code (tracks/<circuit>.track), its id (tracks/index.js) and the
// thumbnail as a data URL (tracks/<circuit>.png). The parts' checksums (tracks/<circuit>/checksums.json) are
// printed by the game itself when it starts with outdated ones: "Part id ... checksum mismatch: <new> != <old>".
(() => {
  let req;
  window.webpackChunk.push([[Symbol('circuit-track')], {}, r => { req = r; }]);
  const TrackData = req(9117).A;
  // The track's id is a hash of its data, not of its parts' meshes: when the road changes but not the gates,
  // the id would stay the same and the records made on the old road would be checked against the new one
  // ("Invalid replay detected"). Each road revision turns the sun by one step, which gives the track a new id.
  // (Forest Speedway's second road: its spins)
  const ROAD_REVISION = { forest: 2 };

  async function build(key) {
    const circuit = await (await fetch('tracks/' + key + '.json')).json();
    const base = TrackData.fromExportString((await (await fetch('tracks/official/summer1.track')).text()).trim()).trackData;
    const sun = new base.sunDirection.constructor(base.sunDirection.representation + (ROAD_REVISION[key] || 1));
    const td = new TrackData(base.environment, sun);
    const { ids, level } = circuit;
    td.addPart(0, level, 0, ids.road, 0, 0, 0, null, null);              // the whole circuit is one part, at the start line
    td.addPart(0, level, 0, ids.start, 0, 0, 0, null, 0);
    circuit.checkpoints.forEach((c, order) => td.addPart(c.gx, c.gy, c.gz, ids.checkpoint, c.rotation, 0, 0, order, null));
    td.addPart(circuit.finish.gx, circuit.finish.gy, circuit.finish.gz, ids.finish, circuit.finish.rotation, 0, 0, null, null);
    return td;
  }

  window.CircuitTrack = {
    build,
    async make(key, name, author = 'GoofyTrack') {
      const td = await build(key);
      const canvas = td.createThumbnail();
      return { code: td.toExportString({ name, author }), id: td.getId(), thumbnail: canvas && canvas.toDataURL ? canvas.toDataURL('image/png') : null };
    },
  };
})();
