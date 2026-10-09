// Adds the ApexRoom hooks to the game's main bundle.
// Always patches from the pristine copy in original/, so it can be re-run safely.
//
// Usage: node patch_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { APP, ORIGINALS, MOD_VERSION, SERVER_URL } = require('./config');
const MOD_TRACKS = require('./tracks');

// Fingerprint of this build: the GoofyTrack server only puts players with the same build in a room,
// so a modified game never meets an older one (their race messages or physics would not match).
const BUILD_SOURCES = ['patch_bundle.js', 'apex-room.js', 'apex-theme.css', 'build_car.js', 'build_patterns.js', 'meshlib.js',
  ...MOD_TRACKS.map(t => path.join('tracks', t.file))];
const BUILD_ID = MOD_VERSION + '-' + BUILD_SOURCES
  .reduce((hash, file) => hash.update(fs.readFileSync(path.join(__dirname, file))), crypto.createHash('sha256'))
  .digest('hex').slice(0, 8);
const SERVER_QUERY = '?mod=' + encodeURIComponent(BUILD_ID);

const SRC = path.join(ORIGINALS, 'main.bundle.js');
const OUT = path.join(APP, 'main.bundle.js');
const HOOK = 'window.ApexRoom&&window.ApexRoom.';
const LOCKED = '(window.ApexRoom&&window.ApexRoom.locked())';
const START = '(0,R.gn)(this,ra,"f").getStartTransform();';
const MENU_OPEN = '(0,R.gn)(this,fs,"f").isEnabled';
const DIALOG_OPEN = '(0,R.gn)(this,ta,"m",bs).call(this)';

// Each patch either inserts text next to an anchor, or replaces `find` with `replace`.
// The anchor / find text must occur exactly once, otherwise the build stops.
const patches = [
  // ---------------------------------------------------------------- room board + ghost
  {
    name: 'room context',
    anchor: 'e(k.multiplayerConnection);const t=.15;',
    before: true,
    insert: HOOK + 'begin({owner:this,connection:k.multiplayerConnection,track:()=>(0,R.gn)(this,ra,"f"),'
      + 'makeCar:()=>new z.A(null,' + START.slice(0, -1) + ',null,null,(0,R.gn)(this,la,"f"),(0,R.gn)(this,ca,"f"),(0,R.gn)(this,aa,"f"),(0,R.gn)(this,ra,"f"),(0,R.gn)(this,Ta,"f"),(0,R.gn)(this,ua,"f"),null),'
      + 'getSelfCar:()=>(0,R.gn)(this,Xa,"f"),interpolate:qr,'
      + 'restart:()=>{(0,R.gn)(this,ta,"m",Ts).call(this),(0,R.gn)(this,ta,"m",Ms).call(this)}});',
  },
  {
    name: 'player list / records changed',
    anchor: 'const n=e.getPlayers();',
    context: 'const n=e.getPlayers();for(const e of n){if(e.isSelf)continue;',
    insert: HOOK + 'onPlayers(n);',
  },
  {
    name: 'remote car update',
    anchor: '((e,n,i,r)=>{if(e!=k.sessionId)return;',
    context: '((e,n,i,r)=>{if(e!=k.sessionId)return;const a=(0,R.gn)(this,as,"f").get(n);',
    insert: HOOK + 'onRemoteState(n,i,r);window.ApexHud&&window.ApexHud.remote(n,r);',
  },
  {
    name: 'per-frame update',
    anchor: '.frames/1e3-t}e.car.update(n)}',
    context: '.frames/1e3-t}e.car.update(n)}(0,R.gn)(this,ta,"m",Cs).call(this)',
    insert: HOOK + 'update(n),window.ApexHud&&window.ApexHud.update(),',
  },
  {
    name: 'game disposed',
    anchor: '(0,R.gn)(this,as,"f").clear(),',
    context: '(0,R.gn)(this,as,"f").clear(),window.removeEventListener("keydown",(0,R.gn)(this,ds',
    insert: HOOK + 'end(this),window.ApexHud&&window.ApexHud.end(this),',
  },

  // ---------------------------------------------------------------- race mode
  {
    name: 'own car spawns on its grid slot',
    find: 'const i=' + START + 'if(null==i)throw new Error("Start transform is null");',
    replace: 'let i=' + START + 'if(null==i)throw new Error("Start transform is null");window.ApexRoom&&(i=window.ApexRoom.startTransform(i));',
  },
  {
    name: 'other cars reset to their grid slot',
    // the player id (n) is shadowed further down in that block, so keep a copy first
    find: 'const r=(0,R.gn)(this,as,"f").get(n);if(null!=r&&i>r.resetCounter){const e=' + START,
    replace: 'const apexId=n,r=(0,R.gn)(this,as,"f").get(n);if(null!=r&&i>r.resetCounter){let e=' + START + 'window.ApexRoom&&null!=e&&(e=window.ApexRoom.remoteStart(apexId,e));',
  },
  {
    name: 'controls locked until the lights go out',
    find: '.isControlsDisabled=' + MENU_OPEN + '||' + DIALOG_OPEN + ',!' + MENU_OPEN + '&&!' + DIALOG_OPEN + '){',
    replace: '.isControlsDisabled=' + MENU_OPEN + '||' + DIALOG_OPEN + '||!!' + LOCKED + ',!' + MENU_OPEN + '&&!' + DIALOG_OPEN + '&&!' + LOCKED + '){',
  },
  {
    name: 'multi-lap races give the physics a track that never finishes',
    find: 'trackData:i.toSaveString(),carId:g',
    // only the car being driven: replays (they come with a recording) must finish where they did
    replace: 'trackData:window.ApexRoom&&null==s?window.ApexRoom.simTrack(i):i.toSaveString(),carId:g',
  },
  {
    // qualifying, formation and race laps: no personal best, no room record, no ghost
    name: 'event runs are never saved or uploaded as records',
    find: 's.addFinishCallback((e=>{const t=e.getTime(),i=e.getRecording(),r=e.getCarStyle();',
    replace: 's.addFinishCallback((e=>{if(window.ApexRoom&&window.ApexRoom.raceActive())return;const t=e.getTime(),i=e.getRecording(),r=e.getCarStyle();',
  },

  {
    name: 'mod texts follow the game language',
    find: 'class js{constructor(e){Hs.set(this,void 0),(0,R.GG)(this,Hs,e,"f")}set language(e){(0,R.GG)(this,Hs,e,"f")}',
    replace: 'class js{constructor(e){Hs.set(this,void 0),(0,R.GG)(this,Hs,e,"f"),window.apexLanguage=e}set language(e){(0,R.GG)(this,Hs,e,"f"),window.apexLanguage=e}',
  },

  // ---------------------------------------------------------------- "Race" game mode on the host screen
  // The server only knows Casual and Competitive: a race room is hosted as Competitive and the mod
  // tells the players running it that the room is a race room.
  {
    name: 'host screen offers a third game mode',
    find: 'for(const e of[an.Casual,an.Competitive]){const t=document.createElement("button");switch(t.className="button",e){case an.Casual:t.textContent=(0,R.gn)(this,bc,"f").get("Casual");break;case an.Competitive:t.textContent=(0,R.gn)(this,bc,"f").get("Competitive")}',
    replace: 'for(const e of window.ApexRoom?[an.Casual,an.Competitive,"race"]:[an.Casual,an.Competitive]){const t=document.createElement("button");switch(t.className="button",e){case an.Casual:t.textContent=(0,R.gn)(this,bc,"f").get("Casual");break;case an.Competitive:t.textContent=(0,R.gn)(this,bc,"f").get("Competitive");break;case"race":t.textContent=window.ApexRoom.modeLabel()}',
  },
  {
    name: 'host screen describes the race mode and shows its options',
    find: 'case an.Competitive:c.textContent=(0,R.gn)(this,bc,"f").get("Players compete to set the best time in the session.")}},c=document.createElement("div")',
    replace: 'case an.Competitive:c.textContent=(0,R.gn)(this,bc,"f").get("Players compete to set the best time in the session.");break;case"race":c.textContent=window.ApexRoom.modeInfo()}window.ApexRoom&&window.ApexRoom.hostModeChanged(a,r)},c=document.createElement("div")',
  },
  {
    name: 'race rooms are hosted as competitive sessions',
    find: 'a=i.startNewSessionImmediate(r,e,t);this.dispose(),(0,R.gn)(this,_c,"f").call(this,e,t,"custom",[],{multiplayerConnection:i,sessionId:a,gameMode:r},!1)',
    replace: 'apexMode=(window.ApexRoom&&window.ApexRoom.hosting(r),"race"===r?an.Competitive:r),a=i.startNewSessionImmediate(apexMode,e,t);this.dispose(),(0,R.gn)(this,_c,"f").call(this,e,t,"custom",[],{multiplayerConnection:i,sessionId:a,gameMode:apexMode},!1)',
  },

  // ---------------------------------------------------------------- mod messages (type 255, reserved by the game)
  {
    name: 'host receives mod messages',
    find: 'case en.ModCustomMessage:break;',
    replace: 'case en.ModCustomMessage:' + HOOK + 'fromPeer(this,t,r.subarray(a)),a=r.length;break;',
  },
  {
    name: 'player receives mod messages',
    find: 'case nn.ModCustomMessage:break;',
    replace: 'case nn.ModCustomMessage:' + HOOK + 'fromHost(this,i.subarray(r)),r=i.length;break;',
  },
  {
    name: 'host exposes its connected players',
    anchor: 'getPlayers(){return(0,R.gn)(this,_n,"f").map(',
    before: true,
    insert: 'apexPeers(){return(0,R.gn)(this,_n,"f")}',
  },
  {
    name: 'player can send mod messages to the host',
    anchor: 'getPlayers(){const e=(0,R.gn)(this,Wl,"f").getCurrentUserProfile()',
    before: true,
    insert: 'apexSend(e){const t=(0,R.gn)(this,Hl,"f");if(null!=t)try{t.send(e)}catch(e){console.error("Failed to send mod message:",e)}}',
  },

  // ---------------------------------------------------------------- mod tracks in the official list
  // A string group gets its own heading after Summer / Winter / Desert. Their records stay local:
  // these tracks do not exist on the game's leaderboard server.
  {
    name: 'mod tracks are listed with the official tracks',
    find: 'thumbnail:"tracks/official/thumbnails/desert5.png"}].map((e=>({id:e.id,group:e.environment,',
    replace: 'thumbnail:"tracks/official/thumbnails/desert5.png"},' + MOD_TRACKS.map(t => '{id:' + JSON.stringify(t.id)
      + ',group:' + JSON.stringify(t.group) + ',trackMetadata:{name:' + JSON.stringify(t.name) + ',author:' + JSON.stringify(t.author)
      + ',lastModified:new Date(' + JSON.stringify(t.lastModified) + ')},environment:Cl.A.Summer,trackUrl:'
      + JSON.stringify('tracks/official/' + t.file) + ',thumbnail:' + JSON.stringify('tracks/official/thumbnails/' + t.thumbnail) + '}').join(',')
      + '].map((e=>({id:e.id,group:e.group??e.environment,',
  },
  {
    name: 'mod track records are never uploaded to the leaderboard',
    find: 'Jd=async function(e,t,n,i,r){if((0,R.gn)(this,jd,"f").determinismState!=Mo.Ok)return null;',
    replace: 'Jd=async function(e,t,n,i,r){if((0,R.gn)(this,jd,"f").determinismState!=Mo.Ok)return null;if(' + JSON.stringify(MOD_TRACKS.map(t => t.id)) + '.includes(t))return null;',
  },

  // ---------------------------------------------------------------- driving HUD (apex-hud.js), every game mode
  {
    name: 'HUD context (track, own car)',
    anchor: '(0,R.gn)(this,ta,"m",Ms).call(this),window.addEventListener("keydown",(0,R.GG)(this,ds',
    before: true,
    insert: 'window.ApexHud&&window.ApexHud.begin({owner:this,track:(0,R.gn)(this,ra,"f"),getSelfCar:()=>(0,R.gn)(this,Xa,"f")}),',
  },

  // ---------------------------------------------------------------- graphics (apex-gfx.js)
  {
    name: 'renderer created: soft shadows',
    anchor: '.add(new r.dth(3891597,11714755,4.7))',
    insert: ',window.ApexGfx&&window.ApexGfx.init((0,i.gn)(this,S,"f"))',
  },
  {
    name: 'before each frame: shadow strength',
    find: '(0,i.gn)(this,S,"f").render((0,i.gn)(this,E,"f"),(0,i.gn)(this,M,"f"))}addMaterial(e){',
    replace: 'window.ApexGfx&&window.ApexGfx.frame((0,i.gn)(this,S,"f"),(0,i.gn)(this,E,"f")),window.ApexScenery&&window.ApexScenery.frame(),(0,i.gn)(this,S,"f").render((0,i.gn)(this,E,"f"),(0,i.gn)(this,M,"f"))}addMaterial(e){',
  },
  {
    name: 'sky dome material',
    anchor: 's.side=M.hsX,s.depthWrite=!1,',
    insert: 'window.ApexGfx&&window.ApexGfx.sky(s),',
  },
  {
    // r is also the geometry the physics reads its vertices from: only its normals are rewritten
    name: 'track parts are shaded smooth across shallow edges',
    find: 'const r=vu.pP(i,!0).toNonIndexed();r.computeVertexNormals();',
    replace: 'const r=vu.pP(i,!0).toNonIndexed();r.computeVertexNormals(),window.ApexGfx&&window.ApexGfx.smooth(r);',
  },

  // ---------------------------------------------------------------- scenery (apex-scenery.js)
  {
    name: 'mountains are redrawn in detail',
    find: '(0,s.gn)(this,f,"f").scene.add(r),(0,s.GG)(this,A,r,"f")}static createMountainVertices',
    replace: '(0,s.gn)(this,f,"f").scene.add(r),(0,s.GG)(this,A,r,"f"),window.ApexScenery&&window.ApexScenery.mountains(r)}static createMountainVertices',
  },
  {
    // the physics must keep colliding with the game's own mountains, vertex for vertex
    name: 'the physics reads the original mountain mesh',
    find: 'const e=(0,s.gn)(this,A,"f").geometry;if(!(e.attributes.position instanceof o.THS))throw new Error("Vertices must use BufferAttribute");return Array.from(e.attributes.position.array)}getMountainOffset',
    replace: 'const e=(0,s.gn)(this,A,"f").userData.apexPhysics||(0,s.gn)(this,A,"f").geometry;if(!(e.attributes.position instanceof o.THS))throw new Error("Vertices must use BufferAttribute");return Array.from(e.attributes.position.array)}getMountainOffset',
  },

  // ---------------------------------------------------------------- our own matchmaking server
  // Rooms are set up through server/ instead of vps.kodub.com (leaderboards still use the official server).
  // The game refuses multiplayer when it finds modified physics or assets; with our server that is allowed,
  // so the game can be changed freely as long as every player runs the same build.
  {
    name: 'rooms are hosted through the GoofyTrack server',
    find: 'createMultiplayerHostWebSocket(){if(this.determinismState!=Mo.Ok)throw new Error("WebSocket creation not allowed with non-deterministic physics");return new WebSocket("https://vps.kodub.com/"+(0,R.gn)(this,Af,"f")+"multiplayer/host")}',
    replace: 'createMultiplayerHostWebSocket(){return new WebSocket(' + JSON.stringify(SERVER_URL + 'multiplayer/host' + SERVER_QUERY) + ')}',
  },
  {
    name: 'rooms are joined through the GoofyTrack server',
    find: 'createMultiplayerJoinWebSocket(){if(this.determinismState!=Mo.Ok)throw new Error("WebSocket creation not allowed with non-deterministic physics");return new WebSocket("https://vps.kodub.com/"+(0,R.gn)(this,Af,"f")+"multiplayer/join")}',
    replace: 'createMultiplayerJoinWebSocket(){return new WebSocket(' + JSON.stringify(SERVER_URL + 'multiplayer/join' + SERVER_QUERY) + ')}',
  },
  {
    // the server turns away a player whose build differs from the host's with the "incompatible mods" reason
    name: 'a different build is reported as such when joining',
    find: 'case"mods-not-vanilla-compatible":n=(0,R.gn)(this,bc,"f").get("Error: Incompatible mods");',
    replace: 'case"mods-not-vanilla-compatible":n=window.ApexRoom?window.ApexRoom.buildMismatch():(0,R.gn)(this,bc,"f").get("Error: Incompatible mods");',
  },
  {
    name: 'ICE servers come from the GoofyTrack server',
    find: 'const n="https://vps.kodub.com/"+(0,R.gn)(this,Af,"f")+"iceServers?version=0.6.3"',
    replace: 'const n=' + JSON.stringify(SERVER_URL + 'iceServers?version=0.6.3'),
  },

  // ---------------------------------------------------------------- invite codes
  {
    name: 'invite code renews itself when it expires',
    find: 'n=setTimeout((()=>{n=null,e.close()}),r)',
    replace: 'n=setTimeout((()=>{n=null,e.close(),setTimeout((()=>{(0,R.gn)(this,Gn,"f")||this.renewInvite(!0)}),1500)}),r)',
  },

  // ---------------------------------------------------------------- main menu footer
  {
    // keeps the copyright and music credit, drops the Google Play / Discord / Reddit links
    name: 'main menu shows the mod version instead of the social links',
    find: '{const e=document.createElement("div");e.className="social-links",(0,R.gn)(this,_h,"f").appendChild(e);{const t=document.createElement("a");t.href="https://www.kodub.com/googleplay/polytrack",t.target="_blank",e.appendChild(t);const n=document.createElement("img");(0,R.gn)(this,ph,"f").hasLoaded()||(n.classList.add("loading"),n.addEventListener("load",(()=>{n.classList.remove("loading")}))),n.src="images/google_play.svg",t.appendChild(n)}const t=document.createElement("a");t.href="https://www.kodub.com/discord/polytrack",t.target="_blank",e.appendChild(t);const n=document.createElement("img");(0,R.gn)(this,ph,"f").hasLoaded()||(n.classList.add("loading"),n.addEventListener("load",(()=>{n.classList.remove("loading")}))),n.src="images/discord.svg",t.appendChild(n);const i=document.createElement("a");i.href="https://www.kodub.com/reddit/polytrack",i.target="_blank",e.appendChild(i);const r=document.createElement("img");(0,R.gn)(this,ph,"f").hasLoaded()||(r.classList.add("loading"),r.addEventListener("load",(()=>{r.classList.remove("loading")}))),r.src="images/reddit.svg",i.appendChild(r)}}',
    replace: '{const e=document.createElement("a");e.textContent=' + JSON.stringify('Mod GoofyTrack V' + MOD_VERSION)
      + ',e.title=' + JSON.stringify('Build ' + BUILD_ID) + ',(0,R.gn)(this,_h,"f").appendChild(e)}}',
  },
];

let code = fs.readFileSync(SRC, 'utf8');
for (const p of patches) {
  const context = p.find || p.context || p.anchor;
  const count = code.split(context).length - 1;
  if (count !== 1) throw new Error(`Patch "${p.name}": expected 1 match, found ${count}. Is this a different game version?`);
  if (p.find) { code = code.replace(p.find, () => p.replace); continue; }
  const at = code.indexOf(context) + (p.before ? 0 : p.anchor.length);
  code = code.slice(0, at) + p.insert + code.slice(at);
}
fs.writeFileSync(OUT, code);
console.log(`Patched main.bundle.js (${patches.length} hooks), build ${BUILD_ID}, server ${SERVER_URL}`);
