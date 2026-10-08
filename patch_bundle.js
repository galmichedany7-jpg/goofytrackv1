// Adds the ApexRoom hooks to the game's main bundle.
// Always patches from the pristine copy in original/, so it can be re-run safely.
//
// Usage: node patch_bundle.js
const fs = require('fs');
const path = require('path');

const { APP, ORIGINALS } = require('./config');
const MOD_TRACKS = require('./tracks');

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
    insert: HOOK + 'onRemoteState(n,i,r);',
  },
  {
    name: 'per-frame update',
    anchor: '.frames/1e3-t}e.car.update(n)}',
    context: '.frames/1e3-t}e.car.update(n)}(0,R.gn)(this,ta,"m",Cs).call(this)',
    insert: HOOK + 'update(n),',
  },
  {
    name: 'game disposed',
    anchor: '(0,R.gn)(this,as,"f").clear(),',
    context: '(0,R.gn)(this,as,"f").clear(),window.removeEventListener("keydown",(0,R.gn)(this,ds',
    insert: HOOK + 'end(this),',
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

  // ---------------------------------------------------------------- invite codes
  {
    name: 'invite code renews itself when it expires',
    find: 'n=setTimeout((()=>{n=null,e.close()}),r)',
    replace: 'n=setTimeout((()=>{n=null,e.close(),setTimeout((()=>{(0,R.gn)(this,Gn,"f")||this.renewInvite(!0)}),1500)}),r)',
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
console.log(`Patched main.bundle.js (${patches.length} hooks)`);
