// Adds the ApexRoom hooks to the game's main bundle.
// Always patches from the pristine copy in original/, so it can be re-run safely.
//
// Usage: node patch_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { APP, ORIGINALS, MOD_VERSION, SERVER_URL, EDITOR_CHUNK } = require('./config');
const MOD_TRACKS = require('./tracks');
const MOD_TRACK_IDS = JSON.stringify(MOD_TRACKS.map(t => t.id));
const MONACO = require('./tracks/monaco/monaco.json');
// Circuits made of free-form track parts (see the "circuits" patches below): the name of their model and of
// its meshes, where they are (written by tools/make_<name>.js) and the SHA-256 of each part's collision mesh,
// as the game computes it (tracks/<name>/checksums.json).
const sumsOf = name => (fs.existsSync(path.join(__dirname, 'tracks', name, 'checksums.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'tracks', name, 'checksums.json'), 'utf8')) : {});
// Monaco GP has tools of its own; the others are the circuits of tools/circuits.js (tools/make_circuit.js)
const MAP_CIRCUITS = require('./tools/circuits');
const CIRCUITS = [
  { name: 'Monaco', model: 'monaco', data: MONACO, sums: sumsOf('monaco') },
  ...Object.entries(MAP_CIRCUITS).map(([key, c]) => ({ name: c.mesh, model: key, data: JSON.parse(fs.readFileSync(path.join(__dirname, 'tracks', key, key + '.json'), 'utf8')), sums: sumsOf(key) })),
];
const circuitParts = c => [['Road', c.data.ids.road], ['Start', c.data.ids.start], ['Checkpoint', c.data.ids.checkpoint], ['Finish', c.data.ids.finish]].map(([part, id]) => [c.name + part, id]);
const RIVIERA_GROUND = 6318394;    // 0x60693a: the Riviera plain (apex-scenery.js recognises the environment by it)

// Fingerprint of this build: the GoofyTrack server only puts players with the same build in a room,
// so a modified game never meets an older one (their race messages or physics would not match).
const BUILD_SOURCES = ['patch_bundle.js', 'apex-room.js', 'apex-show.js', 'apex-collide.js', 'apex-theme.css', 'build_car.js', 'build_patterns.js', 'meshlib.js', path.join('tracks', 'monaco', 'monaco.json'), ...Object.keys(require('./tools/circuits')).flatMap(key => [path.join('tracks', key, key + '.json'), path.join('tracks', key, 'checksums.json')]),   // the checksums stand for the road meshes
  ...MOD_TRACKS.map(t => path.join('tracks', t.file))];
// Hashed as text with LF line endings and no BOM: git on Windows may check the same files out with
// CRLF (and a ZIP download has LF), which must not make two copies of the same code look different.
const sourceText = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const BUILD_ID = MOD_VERSION + '-' + BUILD_SOURCES
  .reduce((hash, file) => hash.update(sourceText(file)), crypto.createHash('sha256'))
  .digest('hex').slice(0, 8);
const SERVER_QUERY = '?mod=' + encodeURIComponent(BUILD_ID);

// Main menu footer, one line each (the first one shows the build in its tooltip)
const FOOTER = [
  '"PolyTrack" Game Remastered by Julio & Shyn',
  'All Credits to © 2026 kodub.com',
  'Music : "Vroum Vroum" & "WAITING" by Teknah',
];

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
      + 'getSelfCar:()=>(0,R.gn)(this,Xa,"f"),remotes:()=>(0,R.gn)(this,as,"f"),interpolate:qr,'
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
    insert: HOOK + 'onRemoteState(n,i,r);window.ApexHud&&window.ApexHud.remote(n,r);window.ApexCollide&&window.ApexCollide.remote(n,i,r);',
  },
  {
    // in a race with collisions the other cars are drawn where they are now, not 150 ms ago (apex-collide.js)
    name: 'per-frame update',
    find: '.frames/1e3-t}e.car.update(n)}(0,R.gn)(this,ta,"m",Cs).call(this)',
    replace: '.frames/1e3-t}window.ApexCollide&&window.ApexCollide.place(e,n),e.car.update(n)}' + HOOK + 'update(n),window.ApexHud&&window.ApexHud.update(),(0,R.gn)(this,ta,"m",Cs).call(this)',
  },
  {
    name: 'game disposed',
    anchor: '(0,R.gn)(this,as,"f").clear(),',
    context: '(0,R.gn)(this,as,"f").clear(),window.removeEventListener("keydown",(0,R.gn)(this,ds',
    insert: HOOK + 'end(this),window.ApexHud&&window.ApexHud.end(this),window.ApexScenery&&window.ApexScenery.trackEnd(this),',
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
    // the physics always starts a car on the track's start line: tell it about the grid slot too
    name: 'own car is simulated from its grid slot',
    find: 'carId:g,carRecording:s?.serialize()??null}',
    replace: 'carId:g,carRecording:s?.serialize()??null,apexStart:window.ApexRoom&&null==s?window.ApexRoom.simStart():null}',
  },
  {
    name: 'the page can talk to the physics worker of the car being driven',
    find: 'carCollisionShapeVertices:a.A.models.collisionShapeVertices,carMassOffset:a.A.massOffset};(0,r.gn)(this,h,"f").postMessage(i)',
    replace: 'carCollisionShapeVertices:a.A.models.collisionShapeVertices,carMassOffset:a.A.massOffset};(0,r.gn)(this,h,"f").postMessage(i),e&&(window.ApexSimWorker=(0,r.gn)(this,h,"f"))',
  },
  {
    // the game fades the other cars out when they are close, and hides all but one of those waiting
    // at the start: a car that can be hit is always there, in full
    name: 'solid cars are drawn solid',
    find: 'for(const n of(0,R.gn)(this,as,"f").values()){const i=n.car.getPosition().distanceTo(e),r=Math.max(0,Math.min(1,i/5));n.car.hasStarted()?(',
    replace: 'for(const n of(0,R.gn)(this,as,"f").values()){const i=n.car.getPosition().distanceTo(e),apexSolid=!!(window.ApexCollide&&window.ApexCollide.isSolid(n)),r=apexSolid?1:Math.max(0,Math.min(1,i/5));n.car.hasStarted()||apexSolid?(',
  },
  {
    name: 'the name tag of a car can be faded (room ghost)',
    anchor: 'setVisible(e){(0,l.gn)(this,me,"f").visible=e}',
    before: true,
    insert: 'apexTagOpacity(e){this.apexTagBase=e;const t=(0,l.gn)(this,Ae,"f");null!=t&&(t.material.opacity=e)}',
  },
  // ---------------------------------------------------------------- name tags (settings > Players)
  // The tags above the other cars (ghosts, opponents, room ghost): flag and name, time of the run.
  // All of them can be hidden, or made fainter, or show the name or the time only. Settings of their own:
  // settings saved by a game without the mod skip the unknown names.
  {
    name: 'name tags: new settings',
    find: 'e[e.TouchSteeringSide=23]="TouchSteeringSide"}',
    replace: 'e[e.TouchSteeringSide=23]="TouchSteeringSide",e[e.ApexNameTags=24]="ApexNameTags",e[e.ApexNameTagOpacity=25]="ApexNameTagOpacity",e[e.ApexNameTagName=26]="ApexNameTagName",e[e.ApexNameTagTime=27]="ApexNameTagTime"}',
  },
  {
    name: 'name tags: shown in full (name and time), fully opaque by default',
    find: '[P.A.TouchSteeringSide,"true"]])}defaultKeyBindings',
    replace: '[P.A.TouchSteeringSide,"true"],[P.A.ApexNameTags,"true"],[P.A.ApexNameTagOpacity,"1"],[P.A.ApexNameTagName,"true"],[P.A.ApexNameTagTime,"true"]])}defaultKeyBindings',
  },
  {
    name: 'name tags: the settings can be read by apex-hud.js',
    anchor: 'const Mf=class{constructor(e){',
    insert: 'window.ApexSettings={manager:this,ids:P.A};',
  },
  {
    name: 'name tags: "Players" section of the settings menu, after the audio',
    find: 'P.A.GhostCarSoundsEnabled),(0,R.gn)(this,qs,"m",go)',
    // the player UI switch greys out the other settings of the section while it is off
    replace: 'P.A.GhostCarSoundsEnabled),window.ApexHud&&(()=>{const apexBox=(0,R.gn)(this,to,"f"),apexRows=[],apexOnOff=[{title:Ks.getFromLanguage((0,R.gn)(this,so,"f"),"Off"),value:"false"},{title:Ks.getFromLanguage((0,R.gn)(this,so,"f"),"On"),value:"true"}];'
      + '(0,R.gn)(this,qs,"m",go).call(this,window.ApexHud.tagLabel("section")),'
      + '(0,R.gn)(this,qs,"m",vo).call(this,window.ApexHud.tagLabel("tags"),apexOnOff,P.A.ApexNameTags,(()=>window.ApexHud.syncTagRows(apexRows))),'
      + '(0,R.gn)(this,qs,"m",vo).call(this,window.ApexHud.tagLabel("name"),apexOnOff,P.A.ApexNameTagName),apexRows.push(apexBox.lastElementChild),'
      + '(0,R.gn)(this,qs,"m",vo).call(this,window.ApexHud.tagLabel("time"),apexOnOff,P.A.ApexNameTagTime),apexRows.push(apexBox.lastElementChild),'
      + '(0,R.gn)(this,qs,"m",Ao).call(this,window.ApexHud.tagLabel("opacity"),P.A.ApexNameTagOpacity,.1,1),apexRows.push(apexBox.lastElementChild),'
      + 'window.ApexHud.syncTagRows(apexRows)})(),(0,R.gn)(this,qs,"m",go)',
  },
  {
    // every slider of the settings menu shows its value, 0 to 100, on its right
    name: 'settings sliders show their value',
    find: 'o.addEventListener("input",(()=>{const e=parseFloat(o.value)/20;(0,R.gn)(this,lo,"f").set(t,e.toString()),(0,R.gn)(this,Ys,"f").updateSettings(Array.from((0,R.gn)(this,lo,"f")))})),a.appendChild(o),(0,R.gn)(this,to,"f").appendChild(a)}',
    replace: 'o.addEventListener("input",(()=>{const e=parseFloat(o.value)/20;apexValue.textContent=Math.round(100*e).toString(),(0,R.gn)(this,lo,"f").set(t,e.toString()),(0,R.gn)(this,Ys,"f").updateSettings(Array.from((0,R.gn)(this,lo,"f")))})),a.appendChild(o);'
      + 'const apexValue=document.createElement("span");apexValue.className="apex-range-value",apexValue.textContent=Math.round(5*parseFloat(o.value)).toString(),a.appendChild(apexValue),(0,R.gn)(this,to,"f").appendChild(a)}',
  },
  {
    // the car keeps what its tag could show; the tag shows what the settings ask for (null: no tag).
    // The third argument, the time of the run in ms, is the mod's: the game never passes it
    name: 'name tags: flag, name and time as set',
    find: 'setNameTag(e,t){null!=(0,l.gn)(this,ve,"f")&&(0,l.gn)(this,ve,"f").countryCode==e&&(0,l.gn)(this,ve,"f").name==t||',
    replace: 'setNameTag(e,t,apexTime){this.apexTagRaw={countryCode:e,name:t,time:void 0!==apexTime?apexTime:this.apexTagRaw?.time??null};'
      + 'const apexShown=window.ApexHud?window.ApexHud.tagContent(this.apexTagRaw):{countryCode:e,name:t};'
      + 'if(null==apexShown)return void(null!=(0,l.gn)(this,ve,"f")&&((0,l.GG)(this,ve,null,"f"),(0,l.gn)(this,D,"m",Fe).call(this)));'
      + 'e=apexShown.countryCode,t=apexShown.name;null!=(0,l.gn)(this,ve,"f")&&(0,l.gn)(this,ve,"f").countryCode==e&&(0,l.gn)(this,ve,"f").name==t||',
  },
  {
    // so a change in the settings shows at once, even over a running game
    name: 'name tags: redrawn when their settings change',
    find: 'update(e){if((0,l.gn)(this,D,"m",Qe).call(this),',
    replace: 'update(e){if(null!=this.apexTagRaw&&window.ApexHud&&this.apexTagStamp!==window.ApexHud.tagStamp()&&(this.apexTagStamp=window.ApexHud.tagStamp(),this.setNameTag(this.apexTagRaw.countryCode,this.apexTagRaw.name)),(0,l.gn)(this,D,"m",Qe).call(this),',
  },
  {
    // every frame, so a change in the settings shows at once, even over a running game
    name: 'name tags: hidden or faded as set',
    find: '(0,l.gn)(this,Ae,"f").visible=(0,l.gn)(this,te,"f").hasStarted&&i>=r*r&&i<=a*a,',
    replace: 'const apexTag=window.ApexHud?window.ApexHud.tagOpacity():1;(0,l.gn)(this,Ae,"f").material.opacity=(this.apexTagBase??1)*apexTag,(0,l.gn)(this,Ae,"f").visible=apexTag>0&&(0,l.gn)(this,te,"f").hasStarted&&i>=r*r&&i<=a*a,',
  },
  {
    // the game names only the cars of a multiplayer game: the time trial ghosts get their player's flag,
    // name and time too (your own ghost: your flag)
    name: 'name tags: on the time trial ghosts',
    find: 'n.setCarStyle(e.settings.carStyle),n.audioVolume=(0,R.gn)(this,vs,"f"),(0,R.gn)(this,ta,"m",Cs).call(this),e.car=n',
    replace: 'n.setCarStyle(e.settings.carStyle),null!=e.settings.nickname&&n.setNameTag(e.settings.countryCode??(e.settings.isSelf?(0,R.gn)(this,ha,"f").getCurrentUserProfile().countryCode:null),e.settings.nickname,e.settings.time.numberOfFrames),n.audioVolume=(0,R.gn)(this,vs,"f"),(0,R.gn)(this,ta,"m",Cs).call(this),e.car=n',
  },
  {
    // the opponents picked in the leaderboard keep their country, for the flag of their ghost
    name: 'name tags: the opponents picked keep their country',
    find: 'concat([{nickname:t,recordingId:l,isSelf:o}])',
    replace: 'concat([{nickname:t,countryCode:n,recordingId:l,isSelf:o}])',
  },
  {
    name: 'name tags: ... up to their ghost',
    find: 'nickname:e[n].nickname,time:t.time,isSelf:e[n].isSelf})))})));else{const e=r.getRecord(i.profileSlot,u);if(null!=e){const t=i.getCurrentUserProfile();v(',
    replace: 'nickname:e[n].nickname,countryCode:e[n].countryCode,time:t.time,isSelf:e[n].isSelf})))})));else{const e=r.getRecord(i.profileSlot,u);if(null!=e){const t=i.getCurrentUserProfile();v(',
  },
  {
    // and their name fades with them when they overlap your car
    name: 'name tags: time trial ghost names fade with their car',
    find: 'if(null!=t.car){const n=t.car.getPosition().distanceTo(e),i=Math.max(0,Math.min(1,n/5));t.car.setOpacity(i)}',
    replace: 'if(null!=t.car){const n=t.car.getPosition().distanceTo(e),i=Math.max(0,Math.min(1,n/5));t.car.setOpacity(i),t.car.apexTagOpacity(i)}',
  },
  {
    // formation and race laps: no personal best, no room record, no ghost (qualifying laps count: ApexRoom.countsAsRecord)
    name: 'formation and race laps are never saved or uploaded as records',
    find: 's.addFinishCallback((e=>{const t=e.getTime(),i=e.getRecording(),r=e.getCarStyle();',
    replace: 's.addFinishCallback((e=>{if(window.ApexRoom&&!window.ApexRoom.countsAsRecord())return;const t=e.getTime(),i=e.getRecording(),r=e.getCarStyle();',
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
  // A string group gets its own heading, above Summer / Winter / Desert. These tracks do not exist on
  // the game's leaderboard server: their leaderboards are kept by the GoofyTrack server (see below).
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
    // the mod groups come first: their heading is put at the top instead of after the others
    name: 'mod track groups are listed first',
    find: '"string"==typeof t){n.appendChild(e);const i=document.createElement("div");i.className="group-title"',
    replace: '"string"==typeof t){' + JSON.stringify([...new Set(MOD_TRACKS.map(t => t.group))]) + '.includes(t)?n.prepend(e):n.appendChild(e);const i=document.createElement("div");i.className="group-title"',
  },

  // ---------------------------------------------------------------- mod track leaderboards (apex-records.js, server/records.js)
  // Same requests, same answers, other server. Record ids from our server start at 8e15, which tells
  // them apart when the game asks for recordings by id alone.
  {
    name: 'mod track leaderboards: board',
    find: 'let a="https://vps.kodub.com/"+(0,R.gn)(this,Af,"f")+"leaderboard?version=0.6.3&trackId="+t+',
    replace: 'let a=(' + MOD_TRACK_IDS + '.includes(t)?' + JSON.stringify(SERVER_URL) + ':"https://vps.kodub.com/"+(0,R.gn)(this,Af,"f"))+"leaderboard?version=0.6.3&trackId="+t+',
  },
  {
    name: 'mod track leaderboards: own entry',
    find: 'const i="https://vps.kodub.com/"+(0,R.gn)(this,Af,"f")+"leaderboardUserEntry?version=0.6.3&trackId="+t+',
    replace: 'const i=(' + MOD_TRACK_IDS + '.includes(t)?' + JSON.stringify(SERVER_URL) + ':"https://vps.kodub.com/"+(0,R.gn)(this,Af,"f"))+"leaderboardUserEntry?version=0.6.3&trackId="+t+',
  },
  {
    name: 'mod track leaderboards: recordings',
    find: 'const t="https://vps.kodub.com/"+(0,R.gn)(this,Af,"f")+"recordings?version=0.6.3&ids="+e.join(",")',
    replace: 'const t=(e.some((e=>e>=8e15))?' + JSON.stringify(SERVER_URL) + ':"https://vps.kodub.com/"+(0,R.gn)(this,Af,"f"))+"recordings?version=0.6.3&ids="+e.join(",")',
  },
  {
    // signed with a secret derived from the token, never with the PolyTrack token itself
    name: 'mod track leaderboards: upload',
    find: 'const o="https://vps.kodub.com/"+(0,R.gn)(this,Af,"f")+"leaderboard";let d="version=0.6.3&userToken="+encodeURIComponent(e)+',
    replace: 'const apexMod=!!window.ApexRecords&&' + MOD_TRACK_IDS + '.includes(r),o=apexMod?' + JSON.stringify(SERVER_URL + 'leaderboard') + ':"https://vps.kodub.com/"+(0,R.gn)(this,Af,"f")+"leaderboard";'
      + 'let d="version=0.6.3&userToken="+encodeURIComponent(apexMod?window.ApexRecords.secret(e):e)+(apexMod?"&userTokenHash="+window.ApexRecords.hash(e):"")+',
  },

  // ---------------------------------------------------------------- driving HUD (apex-hud.js), every game mode
  // The mini-map gets a key binding of its own, set in the game's controls settings (M by default).
  // Saved bindings of a game without the mod skip the unknown "ApexToggleMinimap" name, and the other way round.
  {
    name: 'mini-map key: a new key binding',
    find: 'e[e.PreviewStepBack=34]="PreviewStepBack"}',
    replace: 'e[e.PreviewStepBack=34]="PreviewStepBack",e[e.ApexToggleMinimap=35]="ApexToggleMinimap"}',
  },
  {
    // M was the second key of the cockpit camera: it goes to the mini-map
    name: 'mini-map key: M by default',
    find: '[ge.A.VehicleCockpitCamera,["KeyC","KeyM"]]',
    // the key showing M on the player's keyboard (";" on QWERTY for an AZERTY keyboard)
    replace: '[ge.A.VehicleCockpitCamera,["KeyC",null]],[ge.A.ApexToggleMinimap,[window.ApexHud?window.ApexHud.mapKey():"KeyM",null]]',
  },
  {
    name: 'keys are named as on the player\'s keyboard (AZERTY: Z Q S D...)',
    find: 'function ve(e){const t=me.get(e);return null!=t?t:e}',
    replace: 'function ve(e){const t=window.ApexHud&&window.ApexHud.keyLabel(e)||me.get(e);return null!=t?t:e}',
  },
  {
    name: 'mini-map key: bindings saved before it existed hand M over',
    find: 'n.push([i,[r[0],r[1]]])))}return n}',
    replace: 'n.push([i,[r[0],r[1]]])))}return window.ApexHud?window.ApexHud.migrateKeys(n,ge.A):n}',
  },
  {
    name: 'mini-map key: listed in the controls settings, under the cockpit camera',
    find: '"Cockpit camera"),ge.A.VehicleCockpitCamera),',
    replace: '"Cockpit camera"),ge.A.VehicleCockpitCamera),(0,R.gn)(this,qs,"m",yo).call(this,window.ApexHud?window.ApexHud.mapLabel():"Mini-map",ge.A.ApexToggleMinimap),',
  },
  {
    name: 'mini-map key: shows / hides the mini-map while driving',
    find: 'else if(f.checkKeyBinding(e,ge.A.ToggleUI))',
    replace: 'else if(f.checkKeyBinding(e,ge.A.ApexToggleMinimap))e.repeat||window.ApexHud&&window.ApexHud.toggleMap(),e.preventDefault();else if(f.checkKeyBinding(e,ge.A.ToggleUI))',
  },
  {
    name: 'HUD context (track, own car)',
    anchor: '(0,R.gn)(this,ta,"m",Ms).call(this),window.addEventListener("keydown",(0,R.GG)(this,ds',
    before: true,
    insert: 'window.ApexHud&&window.ApexHud.begin({owner:this,track:(0,R.gn)(this,ra,"f"),getSelfCar:()=>(0,R.gn)(this,Xa,"f")}),window.ApexScenery&&window.ApexScenery.track(this,(0,R.gn)(this,ra,"f")),',
  },
  // The replay viewer builds its own scene: circuits with their own town (Monaco GP) show it there too
  {
    name: 'replay viewer shows the circuit\'s town',
    find: 't.loadTrackData(i),t.refreshMeshes(),a.generateMountains(t.getBounds());const f=t.getStartTransform();',
    replace: 't.loadTrackData(i),t.refreshMeshes(),a.generateMountains(t.getBounds()),window.ApexScenery&&window.ApexScenery.track(this,{getTrackData:()=>i});const f=t.getStartTransform();',
  },
  {
    name: 'replay viewer closed',
    find: 'dispose(){(0,R.gn)(this,Qp,"f").clear(),(0,R.gn)(this,Zp,"f").clearMountains();',
    replace: 'dispose(){window.ApexScenery&&window.ApexScenery.trackEnd(this),(0,R.gn)(this,Qp,"f").clear(),(0,R.gn)(this,Zp,"f").clearMountains();',
  },

  // ---------------------------------------------------------------- graphics (apex-gfx.js)
  {
    name: 'renderer created: soft shadows',
    anchor: '.add(new r.dth(3891597,11714755,4.7))',
    insert: ',window.ApexGfx&&window.ApexGfx.init((0,i.gn)(this,S,"f"),this)',
  },
  {
    // apex-show.js borrows the camera for the picture only (race intro, podium)
    name: 'before each frame: shadow strength',
    find: '(0,i.gn)(this,S,"f").render((0,i.gn)(this,E,"f"),(0,i.gn)(this,M,"f"))}addMaterial(e){',
    replace: 'window.ApexGfx&&window.ApexGfx.frame((0,i.gn)(this,S,"f"),(0,i.gn)(this,E,"f")),window.ApexScenery&&window.ApexScenery.frame(),window.ApexShow&&window.ApexShow.before((0,i.gn)(this,E,"f"),(0,i.gn)(this,M,"f")),(0,i.gn)(this,S,"f").render((0,i.gn)(this,E,"f"),(0,i.gn)(this,M,"f")),window.ApexShow&&window.ApexShow.after((0,i.gn)(this,M,"f"))}addMaterial(e){',
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

  // ---------------------------------------------------------------- Riviera: a fourth environment
  // Track files store the environment as one byte, checked against the game's list: Riviera is added to it
  // (value 3), so it is saved, loaded and shared like Summer, Winter and Desert. Everywhere the game picks
  // something by environment, Riviera gets Summer's (part colours, shadows), except its plain, its thumbnail
  // and its icon. apex-scenery.js draws its coast, sea and villages in place of the mountains.
  {
    name: 'Riviera is a valid environment',
    find: 'e[e.Summer=0]="Summer",e[e.Winter=1]="Winter",e[e.Desert=2]="Desert"',
    replace: 'e[e.Summer=0]="Summer",e[e.Winter=1]="Winter",e[e.Desert=2]="Desert",e[e.Riviera=3]="Riviera"',
  },
  {
    name: 'Riviera ground colour',
    find: 'case x.A.Desert:t=new o.Q1f(11171394)}return t}',
    replace: 'case x.A.Desert:t=new o.Q1f(11171394);break;case x.A.Riviera:t=new o.Q1f(' + RIVIERA_GROUND + ')}return t}',
  },
  {
    name: 'Riviera track parts use the summer colours',
    find: 'case k.A.Desert:t=x.A.Desert}for(let n=0;',
    replace: 'case k.A.Desert:t=x.A.Desert;break;case k.A.Riviera:t=x.A.Summer}for(let n=0;',
  },
  {
    name: 'Riviera shadow colour',
    find: 'case k.A.Desert:c=new y.Q1f(7958351)}',
    replace: 'case k.A.Desert:c=new y.Q1f(7958351);break;case k.A.Riviera:c=new y.Q1f(2511171)}',
  },
  {
    name: 'Riviera tracks have their own group in track lists',
    find: 'case de.A.Desert:n.appendChild(e)}let a,o,l;',
    replace: 'case de.A.Desert:case de.A.Riviera:n.appendChild(e)}let a,o,l;',
  },
  {
    name: 'Riviera group title',
    find: 'case de.A.Desert:a="desert",o=(0,i.gn)(this,b,"f").get("Desert"),l="images/desert_colored.svg"}',
    replace: 'case de.A.Desert:a="desert",o=(0,i.gn)(this,b,"f").get("Desert"),l="images/desert_colored.svg";break;case de.A.Riviera:a="riviera",o="Riviera",l="images/riviera_colored.svg"}',
  },
  {
    name: 'Riviera icon on track cards',
    find: 'case de.A.Desert:f="images/desert.svg"}',
    replace: 'case de.A.Desert:f="images/desert.svg";break;case de.A.Riviera:f="images/riviera.svg"}',
  },
  {
    name: 'Riviera thumbnail colour',
    find: 'case S.A.Desert:f=237,p=226,g=175}',
    replace: 'case S.A.Desert:f=237,p=226,g=175;break;case S.A.Riviera:f=214,p=238,g=255}',
  },
  {
    name: 'Riviera icon on the track page',
    find: 'case Cl.A.Desert:S="images/desert.svg"}',
    replace: 'case Cl.A.Desert:S="images/desert.svg";break;case Cl.A.Riviera:S="images/riviera.svg"}',
  },
  {
    name: 'Riviera colours in the part picker',
    find: 'case Cl.A.Desert:i=yu.A.Desert}const r=n.colors.get(i);',
    replace: 'case Cl.A.Desert:i=yu.A.Desert;break;case Cl.A.Riviera:i=yu.A.Summer}const r=n.colors.get(i);',
  },

  // ---------------------------------------------------------------- circuits: free-form tracks made of custom track parts (Monaco GP, Montbéliard)
  // A track part is any mesh: the game draws it and the physics collides with it as it is. A circuit
  // is one big part (the road), plus a start line and checkpoint / finish gates carrying the detectors.
  // Track files only accept ids from the game's part list, so each circuit's four ids are added to it; the game
  // then checks their collision meshes like any stock part, against the checksums in tracks/<circuit>/checksums.json.
  {
    name: 'circuit part ids are valid in track files',
    find: 'e[e.StartWide=91]="StartWide",',
    replace: 'e[e.StartWide=91]="StartWide",' + CIRCUITS.flatMap(circuitParts).map(([name, id]) => 'e[e.' + name + '=' + id + ']="' + name + '",').join(''),
  },
  {
    name: 'circuit models are loaded with the other track parts',
    find: '"models/road_wide.glb","models/signs.glb","models/wall_track.glb"]',
    replace: '"models/road_wide.glb","models/signs.glb","models/wall_track.glb",' + CIRCUITS.map(c => '"models/' + c.model + '.glb"').join(',') + ']',
  },
  {
    name: 'circuit track parts are registered',
    find: '],f=new Map;for(const e of u){if(f.has(e.id))throw new Error("Duplicate track part id "',
    replace: CIRCUITS.map(({ name, data, sums }) => {
      const cell = '[[[-2,0,-2],[1,0,1]]]';
      const detector = type => '{type:o.A.' + type + ',center:[0,3.5,0],size:[' + data.gateWidth + ',7,1]}';
      const roadTiles = JSON.stringify(data.roadCells.map(([i, j]) => [[4 * i - 2, 0, 4 * j - 2], [4 * i + 1, 0, 4 * j + 1]]));
      const part = (kind, id, rest) => ',new d(' + JSON.stringify(sums[id] || '') + ',r.A.Special,' + id + ',[["' + name + '","' + name + kind + '"]],c,' + rest + ')';
      return part('Road', data.ids.road, roadTiles) + part('Start', data.ids.start, cell + ',null,new i.Pq0(0,.35,0)')
        + part('Checkpoint', data.ids.checkpoint, cell + ',' + detector('Checkpoint')) + part('Finish', data.ids.finish, cell + ',' + detector('Finish'));
    }).join('') + '],f=new Map;for(const e of u){if(f.has(e.id))throw new Error("Duplicate track part id "',
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

  // ---------------------------------------------------------------- settings while driving
  // The home screen's settings menu can be opened over a game too, from the game's toolbar: same
  // menu, same objects. While it is open the game takes it as a dialog: the car and its keys ignore input.
  {
    name: 'settings menu can be opened from anywhere',
    anchor: 'const x=document.createElement("button");x.className="button button-image",x.innerHTML=\'<img src="images/settings.svg">\'',
    before: true,
    insert: 'window.apexOpenSettings=()=>{if(window.apexSettingsOpen)return;const apexMenu=new bo(document.getElementById("ui"),t,n,i,r,a,d,(()=>{apexMenu.dispose(),window.apexSettingsOpen=!1}));window.apexSettingsOpen=!0};',
  },
  {
    name: 'settings button in the game toolbar',
    find: 'v.addEventListener("click",(()=>{t.playUIClick(),o()})),m.appendChild(v),(0,R.gn)(this,gi,"f").push(v),null==s)',
    replace: 'v.addEventListener("click",(()=>{t.playUIClick(),o()})),m.appendChild(v),(0,R.gn)(this,gi,"f").push(v),window.apexOpenSettings&&(()=>{const e=document.createElement("button");e.className="button",e.innerHTML=\'<img class="button-icon" src="images/settings.svg"> \',e.append(document.createTextNode(n.get("Settings"))),e.addEventListener("click",(()=>{t.playUIClick(),window.apexOpenSettings()})),m.appendChild(e),(0,R.gn)(this,gi,"f").push(e)})(),null==s)',
  },
  {
    name: 'the game treats the settings menu as an open dialog',
    find: 'bs=function(){return null!=(0,R.gn)(this,Ba,"f")',
    replace: 'bs=function(){return!!window.apexSettingsOpen||null!=(0,R.gn)(this,Ba,"f")',
  },
  {
    // Escape closes the settings menu only, not the game behind it; pause and the other keys wait too
    name: 'game keys are ignored while the settings menu is open',
    find: 'window.addEventListener("keydown",(0,R.GG)(this,ds,(e=>{if(!I.ip()){',
    replace: 'window.addEventListener("keydown",(0,R.GG)(this,ds,(e=>{if(!I.ip()&&!window.apexSettingsOpen){',
  },

  // ---------------------------------------------------------------- music
  {
    // "Vroum Vroum" by Teknah, copied next to the game's own music by build.js
    name: 'the mod\'s music',
    find: 'l.load("music",["audio/music.ogg","audio/music.mp3"])',
    replace: 'l.load("music",["audio/goofytrack_music.mp3","audio/music.ogg","audio/music.mp3"]),l.load("waiting",["audio/goofytrack_waiting.mp3"])',
  },
  {
    // "WAITING" by Teknah plays in the track selection menu (after Play) and on the page of the track picked,
    // "Vroum Vroum" everywhere else:
    // when the wanted track changes, the playing one fades out and the other starts (and fades in) from the top
    name: 'track selection menu music',
    find: 'if(null==(0,R.gn)(this,y,"f")){const e=this.getBuffer("music");if(null!=e&&null!=this.context&&null!=this.destinationMaster){const t=this.context.createBufferSource();t.buffer=e,t.loop=!0;const n=this.context.createGain();n.gain.value=0,t.connect(n),n.connect(this.destinationMaster),t.start(0),(0,R.GG)(this,y,{source:t,gain:n},"f")}}',
    replace: 'const apexMusic=null!=document.querySelector("#ui .track-selection-ui:not(.hidden), #ui .track-info-ui")&&null!=this.getBuffer("waiting")?"waiting":"music";'
      + 'if(null!=(0,R.gn)(this,y,"f")&&(0,R.gn)(this,y,"f").key!=apexMusic){const e=(0,R.gn)(this,y,"f");e.gain.gain.cancelScheduledValues(0),e.gain.gain.setTargetAtTime(0,0,.2),e.source.stop(this.context.currentTime+1.5),(0,R.GG)(this,y,null,"f")}'
      + 'if(null==(0,R.gn)(this,y,"f")){const e=this.getBuffer(apexMusic);if(null!=e&&null!=this.context&&null!=this.destinationMaster){const t=this.context.createBufferSource();t.buffer=e,t.loop=!0;const n=this.context.createGain();n.gain.value=0,t.connect(n),n.connect(this.destinationMaster),t.start(0),(0,R.GG)(this,y,{source:t,gain:n,key:apexMusic},"f")}}',
  },

  // ---------------------------------------------------------------- main menu footer
  {
    // the mod's credits, the game's copyright and the music (the mod's own, see build.js); no outside links
    name: 'main menu footer: mod credits instead of the social links',
    find: 'const t=document.createElement("a");t.href="https://www.kodub.com",t.target="_blank",t.textContent="© 2026 kodub.com - "+e.get("Version")+" 0.6.3",(0,R.gn)(this,_h,"f").appendChild(t);'
      + 'const n=document.createElement("a");n.href="https://opengameart.org/content/sci-fi-theme-1",n.target="_blank",n.textContent=\'OpenGameArt.org "Sci-fi Theme" by Maou (CC-BY 4.0)\',(0,R.gn)(this,_h,"f").appendChild(n);'
      + '{const e=document.createElement("div");e.className="social-links",(0,R.gn)(this,_h,"f").appendChild(e);{const t=document.createElement("a");t.href="https://www.kodub.com/googleplay/polytrack",t.target="_blank",e.appendChild(t);const n=document.createElement("img");(0,R.gn)(this,ph,"f").hasLoaded()||(n.classList.add("loading"),n.addEventListener("load",(()=>{n.classList.remove("loading")}))),n.src="images/google_play.svg",t.appendChild(n)}const t=document.createElement("a");t.href="https://www.kodub.com/discord/polytrack",t.target="_blank",e.appendChild(t);const n=document.createElement("img");(0,R.gn)(this,ph,"f").hasLoaded()||(n.classList.add("loading"),n.addEventListener("load",(()=>{n.classList.remove("loading")}))),n.src="images/discord.svg",t.appendChild(n);const i=document.createElement("a");i.href="https://www.kodub.com/reddit/polytrack",i.target="_blank",e.appendChild(i);const r=document.createElement("img");(0,R.gn)(this,ph,"f").hasLoaded()||(r.classList.add("loading"),r.addEventListener("load",(()=>{r.classList.remove("loading")}))),r.src="images/reddit.svg",i.appendChild(r)}}',
    replace: 'for(const[t,n]of' + JSON.stringify(FOOTER.map((line, i) => [line, i === 0 ? 'GoofyTrack ' + MOD_VERSION + ' - build ' + BUILD_ID : ''])) + '){const e=document.createElement("a");e.textContent=t,e.title=n,(0,R.gn)(this,_h,"f").appendChild(e)}}',
  },
];

function applyPatches(file, patches) {
let code = fs.readFileSync(path.join(ORIGINALS, file), 'utf8');
for (const p of patches) {
  const context = p.find || p.context || p.anchor;
  const count = code.split(context).length - 1;
  if (count !== 1) throw new Error(`Patch "${p.name}": expected 1 match, found ${count}. Is this a different game version?`);
  if (p.find) { code = code.replace(p.find, () => p.replace); continue; }
  const at = code.indexOf(context) + (p.before ? 0 : p.anchor.length);
  code = code.slice(0, at) + p.insert + code.slice(at);
}
fs.writeFileSync(path.join(APP, file), code);
}

// The physics runs in a worker with its own copy of the part list: it must know the circuits' parts too,
// or it refuses their tracks. Same four ids, same detectors and start offset as in the game's list.
const workerPatches = [
  {
    name: 'Riviera is a valid environment (physics worker)',
    find: 't[t.Summer=0]="Summer",t[t.Winter=1]="Winter",t[t.Desert=2]="Desert"',
    replace: 't[t.Summer=0]="Summer",t[t.Winter=1]="Winter",t[t.Desert=2]="Desert",t[t.Riviera=3]="Riviera"',
  },
  // ---- car against car (apex-collide.js)
  {
    name: 'collision code is loaded next to the physics',
    find: 'importScripts("lib/polytrack_physics.js");',
    replace: 'importScripts("lib/polytrack_physics.js","apex-collide.js");',
  },
  {
    name: 'the worker receives the other cars from the page',
    find: 'function r(i){const r=i.data;switch(r.messageType){case Ki.Init:',
    replace: 'function r(i){const r=i.data;if(self.ApexCollide&&self.ApexCollide.message(r))return;switch(r.messageType){case Ki.Init:',
  },
  {
    name: 'cars are tested against each other after every physics step',
    find: '[e.id,r.up,r.right,r.down,r.left,r.reset,i]);return new Uint8Array(t.HEAPU8.buffer,i,227).slice().buffer}',
    replace: '[e.id,r.up,r.right,r.down,r.left,r.reset,i]);self.ApexCollide&&self.ApexCollide.afterStep(t,e,i);return new Uint8Array(t.HEAPU8.buffer,i,227).slice().buffer}',
  },
  {
    name: 'a car can start from a grid slot instead of the start line',
    find: 'const o=i.getStartTransform();if(null==o)throw new Error("Track has no starting point");const l=t.carId;',
    replace: 'let o=i.getStartTransform();if(null==o)throw new Error("Track has no starting point");t.apexStart&&(o=t.apexStart);const l=t.carId;',
  },
  {
    name: 'circuit part ids are valid in track files (physics worker)',
    find: 't[t.StartWide=91]="StartWide",',
    replace: 't[t.StartWide=91]="StartWide",' + CIRCUITS.flatMap(circuitParts).map(([name, id]) => 't[t.' + name + '=' + id + ']="' + name + '",').join(''),
  },
  {
    name: 'circuit track parts are registered (physics worker)',
    find: '],co=new Map;for(const t of ho){if(co.has(t.id))throw new Error("Duplicate track part id "',
    replace: CIRCUITS.map(({ name, data }) => {
      const cell = '[[[-2,0,-2],[1,0,1]]]';
      const detector = type => '{type:to.' + type + ',center:[0,3.5,0],size:[' + data.gateWidth + ',7,1]}';
      const part = (kind, id, rest) => ',new lo("",Xa.Special,' + id + ',[["' + name + '","' + name + kind + '"]],ao,' + cell + rest + ')';
      return part('Road', data.ids.road, '') + part('Start', data.ids.start, ',null,new R(0,.35,0)')
        + part('Checkpoint', data.ids.checkpoint, ',' + detector('Checkpoint')) + part('Finish', data.ids.finish, ',' + detector('Finish'));
    }).join('') + '],co=new Map;for(const t of ho){if(co.has(t.id))throw new Error("Duplicate track part id "',
  },
];

// The editor is a chunk of its own: its track settings get a fourth environment button
const editorPatches = [
  {
    name: 'Riviera button in the track settings',
    anchor: 'k.appendChild(A);',
    context: 'k.appendChild(A);const M=document.createElement("div");M.className="setting"',
    insert: 'const apexRiviera=document.createElement("button");apexRiviera.className="button environment-button",o.environment==Dt.A.Riviera&&(apexRiviera.classList.add("selected"),apexRiviera.disabled=!0),apexRiviera.innerHTML=\'<img src="images/riviera.svg"> \',apexRiviera.append(document.createTextNode("Riviera")),'
      + 'apexRiviera.addEventListener("click",(()=>{t.playUIClick(),a(Dt.A.Riviera);for(const e of[x,y,A])e.classList.remove("selected"),e.disabled=!1;apexRiviera.classList.add("selected"),apexRiviera.disabled=!0})),k.appendChild(apexRiviera),'
      + 'k.addEventListener("click",(e=>{const n=e.target.closest&&e.target.closest(".environment-button");n&&n!==apexRiviera&&(apexRiviera.classList.remove("selected"),apexRiviera.disabled=!1)}),!0);',
  },
  {
    name: 'four environment buttons side by side',
    find: 'width: calc(100% / 3);',
    replace: 'width: calc(100% / 4);',
  },
  {
    name: 'Riviera colours in the editor\'s part list',
    find: 'case Dt.A.Desert:t=at.A.Desert}for(const e of(0,i.gn)(this,Gn,"f"))if(null!=e.id)',
    replace: 'case Dt.A.Desert:t=at.A.Desert;break;case Dt.A.Riviera:t=at.A.Summer}for(const e of(0,i.gn)(this,Gn,"f"))if(null!=e.id)',
  },
  {
    name: 'Riviera colours in the editor\'s part thumbnails',
    find: 'case Dt.A.Desert:e=at.A.Desert}for(const n of(0,i.gn)(this,Gn,"f"))if(n.category==t',
    replace: 'case Dt.A.Desert:e=at.A.Desert;break;case Dt.A.Riviera:e=at.A.Summer}for(const n of(0,i.gn)(this,Gn,"f"))if(n.category==t',
  },
];

// The desktop app's window: the GoofyTrack icon (otherwise Windows shows the one inside PolyTrack.exe)
const electronPatches = [
  {
    name: 'window icon',
    find: 'autoHideMenuBar:!0,',
    replace: 'autoHideMenuBar:!0,icon:path.join(__dirname,"..","images","goofytrack_icon.ico"),',
  },
];

applyPatches('main.bundle.js', patches);
applyPatches(path.join('electron', 'main.js'), electronPatches);
applyPatches('simulation_worker.bundle.js', workerPatches);
applyPatches(EDITOR_CHUNK, editorPatches);
console.log(`Patched main.bundle.js (${patches.length} hooks), the physics worker (${workerPatches.length}) and the editor (${editorPatches.length}), build ${BUILD_ID}, server ${SERVER_URL}`);
