// GoofyTrack matchmaking server: stands in for the PolyTrack servers the game uses to set up a room.
//
// The game itself is peer to peer (WebRTC between the host and each player). A server is only needed
// to hand out invite codes and to pass the WebRTC offer / answer / ICE candidates between the host and
// a player joining it. This one speaks the same JSON protocol as the official server:
//
//   GET  /iceServers           STUN / TURN servers the players use to reach each other
// The game adds ?mod=<build> to both WebSocket URLs: a player is only let into a room hosted with the
// same build of the mod, so two players never race with different code.
//
//   WS   /multiplayer/host     host: createInvite -> code; then receives joinInvite / iceCandidate / joinDisconnect
//   WS   /multiplayer/join     player: sends the code and its offer, receives acceptJoin / declineJoin / iceCandidate
//   GET  /health               wakes the server up (free hosts put it to sleep when idle)
//
// It also keeps the leaderboards of the mod's own tracks (records.js): /leaderboard, /leaderboardUserEntry, /recordings.
//
//   PORT=8787 node server.js
//   ICE_SERVERS='[{"urls":"turn:...","username":"...","credential":"..."}]' adds TURN servers (optional)
//   GITHUB_TOKEN=...           keeps the records in a secret gist of that GitHub account (otherwise in records.json)
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { createRecords } = require('./records');

const records = createRecords();

const PORT = Number(process.env.PORT) || 8787;
const GAME_VERSION = '0.6.3';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
const CODE_LENGTH = 6;
const MAX_HOSTS = 200;

const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  ...JSON.parse(process.env.ICE_SERVERS || '[]'),
];

const hosts = new Map();    // invite code -> { socket, key, build, joins: Map(session -> join socket) }
const codeByKey = new Map(); // key -> invite code, lets a host get its code back after a reconnect

const send = (socket, message) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ version: GAME_VERSION, ...message }));
};
const parse = data => {
  try { const m = JSON.parse(String(data)); return m != null && typeof m === 'object' ? m : null; } catch { return null; }
};
const newCode = () => {
  for (;;) {
    let code = '';
    for (const byte of crypto.randomBytes(CODE_LENGTH)) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    if (!hosts.has(code)) return code;
  }
};
// players type codes by hand: ignore case, spaces and dashes
const normalizeCode = code => (typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');

// ------------------------------------------------------------------ host
function onHost(socket, build) {
  let code = null;

  socket.on('message', data => {
    const m = parse(data);
    if (m == null) return socket.close();
    switch (m.type) {
      case 'ping':
        return send(socket, { type: 'pong' });

      case 'createInvite': {
        if (code == null) {
          const previous = typeof m.key === 'string' ? codeByKey.get(m.key) : undefined;
          if (previous != null && !hosts.has(previous)) code = previous;
          else if (hosts.size >= MAX_HOSTS) return send(socket, { type: 'error', error: 'TotalHostLimit' });
          else code = newCode();
          const key = crypto.randomBytes(16).toString('hex');
          for (const [k, c] of codeByKey) if (c === code) codeByKey.delete(k);
          codeByKey.set(key, code);
          hosts.set(code, { socket, key, build, joins: new Map() });
        }
        const host = hosts.get(code);
        const nickname = typeof m.nickname === 'string' ? m.nickname.slice(0, 32) : null;
        // timeoutMilliseconds null: the code stays valid as long as the host is connected
        return send(socket, { type: 'createInvite', inviteCode: code, key: host.key, timeoutMilliseconds: null, censoredNickname: nickname });
      }

      case 'acceptJoin':
      case 'declineJoin':
      case 'iceCandidate': {
        const join = code != null && hosts.get(code).joins.get(m.session);
        if (!join) return;
        const { session, ...forward } = m;
        send(join, forward);
        if (m.type === 'declineJoin') join.close();
        return;
      }
    }
  });

  socket.on('close', () => {
    if (code == null) return;
    const host = hosts.get(code);
    hosts.delete(code);
    for (const join of host.joins.values()) { send(join, { type: 'error', error: 'ExpiredInvite' }); join.close(); }
    console.log(`room ${code} closed (${hosts.size} open)`);
  });
}

// ------------------------------------------------------------------ player joining a host
function onJoin(socket, build) {
  let host = null;
  const session = crypto.randomUUID();

  socket.on('message', data => {
    const m = parse(data);
    if (m == null) return socket.close();

    if (host == null) { // first message: the invite code and the WebRTC offer
      host = hosts.get(normalizeCode(m.inviteCode));
      if (host == null) { send(socket, { type: 'error', error: 'ExpiredInvite' }); return socket.close(); }
      if (host.build !== build) {
        console.log(`room ${normalizeCode(m.inviteCode)}: refused build ${build} (host runs ${host.build})`);
        send(socket, { type: 'declineJoin', reason: 'IncompatibleMods' });
        return socket.close();
      }
      host.joins.set(session, socket);
      send(host.socket, {
        type: 'joinInvite', session, offer: m.offer, version: m.version, mods: m.mods,
        isModsVanillaCompatible: m.isModsVanillaCompatible, nickname: m.nickname, countryCode: m.countryCode,
        carStyle: m.carStyle, iceServers: ICE_SERVERS,
      });
      return;
    }
    if ('candidate' in m) send(host.socket, { type: 'iceCandidate', session, candidate: m.candidate });
  });

  socket.on('close', () => {
    if (host == null) return;
    host.joins.delete(session);
    send(host.socket, { type: 'joinDisconnect', session });
  });
}

// ------------------------------------------------------------------ http
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // the game runs from file:// in the desktop app, so any origin may ask
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (url.pathname === '/iceServers') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(ICE_SERVERS));
  }
  if (url.pathname === '/health' || url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    const r = records.stats();
    return res.end(`GoofyTrack server: ${hosts.size} room(s) open, records ${r.ready ? `on ${r.tracks} track(s)` : 'loading'}\n`);
  }
  if (records.handle(req, res, url)) return;
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  const build = url.searchParams.get('mod') || 'none';
  const handler = path === '/multiplayer/host' ? onHost : path === '/multiplayer/join' ? onJoin : null;
  if (handler == null) return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => {
    // free hosts drop idle connections: keep them alive
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    handler(ws, build);
  });
});
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

server.listen(PORT, () => console.log(`GoofyTrack server listening on port ${PORT}`));
// rooms work right away; the records come up as soon as they are read (from the gist, a few seconds)
const loadRecords = () => records.load().catch(e => { console.error('records: load failed, retrying in 30 s:', e.message); setTimeout(loadRecords, 30000); });
loadRecords();
// a restart (new deploy) must not lose the last record waiting to be saved
process.on('SIGTERM', () => records.flush().finally(() => process.exit(0)));
