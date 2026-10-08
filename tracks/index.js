// Tracks shipped with the mod. build.js copies them next to the game's official tracks and
// patch_bundle.js lists them in the official track list, under their own group.
//
// id: the track's id as the game computes it (TrackData.getId(), a hash of the track data).
//     Regenerate it whenever the .track file changes: in the game's page,
//     webpackChunk.push([[Symbol()], {}, r => { req = r }]);
//     req(9117).A.fromExportString(code).trackData.getId()
// thumbnail: TrackData.createThumbnail() saved as png (one pixel per cell, like the official ones).
module.exports = [
  {
    file: 'killer_loop.track',
    thumbnail: 'killer_loop.png',
    id: 'dd4d3636b347118d57dcb7ea309bb553c4c1e35bf6252d4d77ad705c2cb6fec2',
    name: 'Killer Loop',
    author: 'GoofyTrack',
    lastModified: '2026-10-08T12:00:00.000Z',
    group: 'Circuits',
  },
];
