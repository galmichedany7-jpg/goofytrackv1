// Apex records: the leaderboards of the mod's own tracks (Killer Loop, Monaco GP...).
//
// Those tracks do not exist on the PolyTrack servers. patch_bundle.js sends their leaderboard requests
// to the GoofyTrack server instead (server/records.js), in the same format, so the game's leaderboard
// screen, ghosts and "Watch" work on them as on any official track. Records set on other tracks still
// go to PolyTrack, untouched.
//
// The PolyTrack token never leaves the game for our server: a record is signed with a secret derived
// from it, and the player is known there by the same public hash as on the official boards.
(() => {
  'use strict';

  const SHA256_MODULE = 1312;     // webpack id of the game's sha256 (PolyTrack 0.6.3)

  let webpackRequire = null;
  const sha256 = text => {
    if (webpackRequire == null) window.webpackChunk.push([[Symbol('apex-records')], {}, r => { webpackRequire = r; }]);
    return webpackRequire(SHA256_MODULE).sha256(text);
  };

  window.ApexRecords = {
    hash: token => sha256(token),                                // = the profile's tokenHash
    secret: token => sha256('goofytrack-records:' + token),
  };
})();
