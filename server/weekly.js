// Track of the Week: one of the official tracks (the game's, the community ones listed with them and the mod's
// circuits), drawn at random each week, the same for every player. Stands in for the PolyTrack server's.
//
//   GET  /trackOfTheWeek       { serverTime, current: { trackId, endTime } | null }
//
// The game knows the tracks themselves (name, author, thumbnail, track file): only the id comes from here.
// official_tracks.json is the list of their ids, written by build.js. The weeks start on Monday 00:00 UTC;
// each round of weeks goes through every track once, in an order shuffled for that round.
const fs = require('fs');
const path = require('path');

const WEEK = 7 * 24 * 3600 * 1000;
const FIRST_WEEK = Date.UTC(2026, 9, 19);   // a Monday: week 0
const SEED = 0x60f1;

const loadTracks = () => {
  try { return [...new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'official_tracks.json'), 'utf8')))].sort(); } catch { return []; }
};

// mulberry32: a small seeded generator, so every server restart draws the same tracks
const random = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const createWeekly = (tracks = loadTracks()) => {
  const shuffled = round => {
    const order = [...tracks], next = random(SEED + round);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  };
  const rounds = new Map();   // round -> its order
  const orderOf = round => {
    if (!rounds.has(round)) {
      const order = shuffled(round);
      // never the same track two weeks in a row, from one round to the next
      if (order.length > 2 && order[0] === shuffled(round - 1)[order.length - 1]) [order[0], order[1]] = [order[1], order[0]];
      rounds.set(round, order);
    }
    return rounds.get(round);
  };
  const current = (now = Date.now()) => {
    if (!tracks.length) return null;
    const week = Math.floor((now - FIRST_WEEK) / WEEK);
    const round = Math.floor(week / tracks.length);
    return { trackId: orderOf(round)[week - round * tracks.length], endTime: new Date(FIRST_WEEK + (week + 1) * WEEK).toISOString() };
  };
  return {
    current,
    tracks: () => tracks.length,
    handle(req, res, url) {
      if (url.pathname !== '/trackOfTheWeek') return false;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ serverTime: new Date().toISOString(), current: current() }));
      return true;
    },
  };
};

module.exports = { createWeekly };
