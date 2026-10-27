// Adds the ApexRoom hooks to the game's main bundle.
// Always patches from the pristine copy in original/, so it can be re-run safely.
//
// Usage: node patch_bundle.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { APP, ORIGINALS, MOD_VERSION, SERVER_URL, EDITOR_CHUNK, GARAGE_CHUNK } = require('./config');
const MOD_TRACKS = require('./tracks');
const MOD_TRACK_IDS = JSON.stringify(MOD_TRACKS.map(t => t.id));
const MONACO = require('./tracks/monaco/monaco.json');
// Circuits made of free-form track parts (see the "circuits" patches below): the name of their model and of
// its meshes, where they are (written by tools/make_<name>.js) and the SHA-256 of each part's collision mesh,
// as the game computes it (tracks/<name>/checksums.json).
const sumsOf = name => (fs.existsSync(path.join(__dirname, 'tracks', name, 'checksums.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'tracks', name, 'checksums.json'), 'utf8')) : {});
// Monaco GP has tools of its own; the others are the circuits of tools/circuits.js (tools/make_circuit.js)
const MAP_CIRCUITS = require('./tools/circuits');
// `start`: how high above the start line the car appears. The game's own start parts have it 0.35 m up, above their
// thicker road; on a circuit whose road is a sheet at the line's height, the car dropped from there and lost time
// bouncing. The ones set here appear where the car rests (measured in the game); the others keep 0.35.
const CIRCUITS = [
  { name: 'Monaco', model: 'monaco', data: MONACO, sums: sumsOf('monaco'), start: 0.18 },
  ...Object.entries(MAP_CIRCUITS).map(([key, c]) => ({ name: c.mesh, model: key, data: JSON.parse(fs.readFileSync(path.join(__dirname, 'tracks', key, key + '.json'), 'utf8')), sums: sumsOf(key), start: c.startHeight })),
];
const circuitParts = c => [['Road', c.data.ids.road], ['Start', c.data.ids.start], ['Checkpoint', c.data.ids.checkpoint], ['Finish', c.data.ids.finish]].map(([part, id]) => [c.name + part, id]);
// The mod's car patterns (build_patterns.js), numbered 16 on after the game's: never reorder them, a car
// saved with one keeps its number (apex-rarity.js names them in this order)
const MOD_PATTERNS = ['monaco', 'bignumber', 'diagonal', 'wingtips', 'dotted', 'camo', 'lightning', 'flames', 'tiger', 'barcode', 'carbon',
  'spa', 'strasbourg', 'dijon', 'montbeliard', 'coaster', 'killer_loop', 'goofy', 'champion', 'mp4_7a'];
// The mod's wings (build_car.js draws Wing0.., apex-rarity.js names them in this order)
const WING_COUNT = 9;
// The mod's bodies (build_car.js: the car's own Body, then Body1..), and its rims and exhausts after the game's
// 12 and 8 (Wheel12.., Exhaust8..)
const BODY_COUNT = 2, MOD_RIMS = 1, MOD_EXHAUSTS = 1;
// The rims whose tyres are lettered: on the side the game mirrors, turned round instead (build_car.js)
const TURNED_RIMS = [12];
// The icons' patterns (apex-rarity.js): real cars' liveries, which keep their own colours. The car style gives
// them in place of the primary and secondary colours (those picked stay for the other patterns), and their wings
// take the pattern. [primary, secondary] by pattern.
const ICONS = { mp4_7a: [0xf3f3ef, 0xf2361e] };
const ICON_COLOURS = JSON.stringify(Object.fromEntries(Object.entries(ICONS).map(([name, colours]) => [16 + MOD_PATTERNS.indexOf(name), colours])));
// The engine's sound by body (build_car.js), in audio/ (tools/make_engine_sound.js); the others have the game's
const ENGINE_SOUNDS = { 1: 'engine_mp4_7a' };
// The lettering of the tyres (build_car.js, TireText), from the rims' colour: gold on dark rims, black on light ones
const LETTERING = rims => '(((' + rims + '>>16&255)*.299+(' + rims + '>>8&255)*.587+(255&' + rims + ')*.114)<150?15776808:1118481)';
// The paint, from the pattern's picture (build_patterns.js): green is the secondary colour, red the primary, and
// two inks no picker changes, blue for black and none of the three for gold (every other pattern is red and
// green only). shade(source) gives the shader lines, source scaling the pattern (the wings may leave it out).
const shade = source => 'vec4 apxPattern = texture(carColorPattern, vUv);\\nfloat colorSource = apxPattern.g' + source + ';\\n'
  + 'vec3 apxColor = carColorSecondary * colorSource + diffuse * (1.0 - colorSource);\\n'
  + 'apxColor = mix(apxColor, vec3(0.012), apxPattern.b' + source + ');\\n'
  + 'apxColor = mix(apxColor, vec3(0.85, 0.55, 0.02), clamp(1.0 - apxPattern.r - apxPattern.g - apxPattern.b, 0.0, 1.0)' + source + ');\\n'
  + 'vec4 diffuseColor = vec4( apxColor, opacity );';
const RIVIERA_GROUND = 6318394;    // 0x60693a: the Riviera plain (apex-scenery.js recognises the environment by it)

// Fingerprint of this build: the GoofyTrack server only puts players with the same build in a room,
// so a modified game never meets an older one (their race messages or physics would not match).
const BUILD_SOURCES = ['patch_bundle.js', 'apex-room.js', 'apex-show.js', 'apex-collide.js', 'apex-sand.js', 'apex-theme.css', 'build_car.js', 'build_patterns.js', 'meshlib.js', path.join('tracks', 'monaco', 'monaco.json'), ...Object.keys(require('./tools/circuits')).flatMap(key => [path.join('tracks', key, key + '.json'), path.join('tracks', key, 'checksums.json')]),   // the checksums stand for the road meshes
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
  'Musics by Teknah',
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
    // and what the room list shows of the room: mode (0 casual, 1 competitive), track name, size
    insert: 'apexPeers(){return(0,R.gn)(this,_n,"f")}apexInfo(){return{mode:(0,R.gn)(this,wn,"f"),track:(0,R.gn)(this,bn,"f")?.trackMetadata?.name??null,maxPlayers:(0,R.gn)(this,Sn,"f")}}',
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
  {
    // The community tracks join them too, grouped by environment (Summer, Winter, Desert, Riviera) after the game's
    // own: one list under the game's headings, which "next track" goes through in the order shown (the mod tracks
    // stay last). Records and boards work the same for both. The list is left at hand for the Track of the Week (below).
    name: 'community tracks are listed with the official tracks',
    find: 'saveTime:null}))),"f");const i=(0,R.gn)(this,au,"f").getAllCustomTrackNames();',
    replace: 'saveTime:null}))),"f");{const apexRank=e=>e==Cl.A.Summer?0:e==Cl.A.Winter?1:e==Cl.A.Desert?2:3,apexOfficial=(0,R.gn)(this,eu,"f");'
      + '(0,R.GG)(this,eu,[...apexOfficial.filter((e=>"string"!=typeof e.group)),...(0,R.gn)(this,tu,"f").map((e=>({...e,group:e.environment})))]'
      + '.sort(((e,t)=>apexRank(e.environment)-apexRank(t.environment))).concat(apexOfficial.filter((e=>"string"==typeof e.group))),"f"),(0,R.GG)(this,tu,[],"f"),'
      + 'window.ApexOfficialTracks=(0,R.gn)(this,eu,"f")}'
      + 'const i=(0,R.gn)(this,au,"f").getAllCustomTrackNames();',
  },
  // The community tab is gone (the tournaments will take its place): the official tab is the first one again,
  // swiping goes from it straight to the custom tracks, and a tab remembered as "community" opens the official one.
  {
    name: 'no community tab',
    find: '(0,i.gn)(this,A,"m",ae).call(this,"community")})),v.appendChild((0,i.gn)(this,P,"f"));',
    replace: '(0,i.gn)(this,A,"m",ae).call(this,"community")}));',
  },
  {
    name: 'no community tab: swipe',
    find: 't>0?"community"==pe?(0,i.gn)(this,A,"m",ae).call(this,"official"):"custom"==pe&&(0,i.gn)(this,A,"m",ae).call(this,"community"):"official"==pe?(0,i.gn)(this,A,"m",ae).call(this,"community"):"community"==pe&&(0,i.gn)(this,A,"m",ae).call(this,"custom")',
    replace: 't>0?"custom"==pe&&(0,i.gn)(this,A,"m",ae).call(this,"official"):"official"==pe&&(0,i.gn)(this,A,"m",ae).call(this,"custom")',
  },
  {
    name: 'no community tab: remembered tab',
    find: 'if("official"==e||"community"==e||"custom"==e)return e',
    replace: 'if("official"==e||"custom"==e)return e',
  },

  // ---------------------------------------------------------------- Track of the Week (server/weekly.js)
  // One of the official tracks above, drawn each week by the GoofyTrack server instead of PolyTrack's. The server
  // only gives its id and end time: the game takes the rest from its own list, and loads it from the game files
  // like the other official tracks (it is then played as one: records, "next track"). Shown at the top of the
  // official tab, sized like its rows of tracks.
  {
    name: 'Track of the Week from the GoofyTrack server',
    find: 'async getTrackOfTheWeek(){',
    replace: 'async getTrackOfTheWeek(){return new Promise(((t,n)=>{const i=new XMLHttpRequest;i.timeout=(0,R.gn)(this,gf,"f"),i.overrideMimeType("text/plain"),'
      + 'i.onreadystatechange=()=>{if(i.readyState==XMLHttpRequest.DONE)if(200==i.status)try{const e=JSON.parse(i.responseText),r=new Date(e.serverTime),'
      + 'a=null==e.current?null:(window.ApexOfficialTracks??[]).find((t=>t.id==e.current.trackId));if(null==a)return void t({current:null});'
      + 'const s=new Date(e.current.endTime);if(isNaN(r.getTime())||isNaN(s.getTime()))return void n(new Error("Invalid dates"));'
      + 't({current:{trackId:a.id,trackMetadata:a.trackMetadata,environment:a.environment,thumbnailUrl:a.thumbnail,coverUrl:null,trackUrl:null,'
      + 'endTime:s,clientEndTime:new Date(s.getTime()+(Date.now()-r.getTime())),apexLoad:a.loadCallback}})}catch(e){n(new Error("Unknown error: "+String(e)))}'
      + 'else n(new Error("Failed to connect to server"))},i.open("GET",' + JSON.stringify(SERVER_URL + 'trackOfTheWeek') + ',!0),i.send()}))}'
      + 'async apexKodubTrackOfTheWeek(){',
  },
  {
    name: 'Track of the Week is loaded from the game files',
    find: '(async()=>{let e;try{e=await(0,i.gn)(this,x,"f").loadTrackCodeFromUrl(r.trackUrl)}catch(e){throw console.error(e),new ue.A}const t=ce.A.fromExportString(e);if(null==t)throw new ue.A;return t.trackData}),"community",r.trackId,r.thumbnailUrl)',
    replace: '(async()=>{if(null!=r.apexLoad)return(await r.apexLoad()).trackData;let e;try{e=await(0,i.gn)(this,x,"f").loadTrackCodeFromUrl(r.trackUrl)}catch(e){throw console.error(e),new ue.A}const t=ce.A.fromExportString(e);if(null==t)throw new ue.A;return t.trackData}),null!=r.apexLoad?"official":"community",r.trackId,r.thumbnailUrl)',
  },
  {
    // a thumbnail of the game files, not of another site
    name: 'Track of the Week thumbnail',
    find: 't.crossOrigin="anonymous",t.loading="lazy",t.className="thumbnail loading"',
    replace: 'null==r.apexLoad&&(t.crossOrigin="anonymous"),t.loading="lazy",t.className="thumbnail loading"',
  },
  {
    name: 'Track of the Week in the official tab',
    find: 'const r=document.createElement("div");t.appendChild(r),(0,i.gn)(this,A,"m",ne).call(this,r);',
    replace: 'const r=document.createElement("div");e.prepend(r),(0,i.gn)(this,A,"m",ne).call(this,r);',
  },
  {
    name: 'Track of the Week sized when the official tab opens',
    find: '(0,i.gn)(this,L,"f").classList.add("open"),(0,i.gn)(this,z,"f").classList.remove("open"),(0,i.gn)(this,U,"f").classList.remove("open")):"community"==e?',
    replace: '(0,i.gn)(this,L,"f").classList.add("open"),(0,i.gn)(this,z,"f").classList.remove("open"),(0,i.gn)(this,U,"f").classList.remove("open"),(0,i.gn)(this,A,"m",re).call(this)):"community"==e?',
  },
  {
    // as wide as a whole number of track cards: the theme makes them wider than the game's 236 px
    name: 'Track of the Week sized on the track cards',
    find: 'const e=236,t=Math.floor((0,i.gn)(this,F,"f").parentElement.clientWidth/e);',
    replace: 'const e=document.querySelector(".track-selection-ui .tracks-container.open .track:not(.track-of-the-week)")?.offsetWidth||236,t=Math.max(1,Math.floor((0,i.gn)(this,F,"f").parentElement.clientWidth/e));',
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
  {
    // three.js's mergeVertices keys every vertex with a string: on the circuits' hundreds of thousands of vertices,
    // three times each (one per part colour), most of the loading time went into it. ApexGfx.merge gives the same
    // geometry with integer keys, and hands the original the geometries it does not handle.
    name: 'track parts merge their vertices quickly',
    find: 'const o=vu.ec(r),c=new M.eaF(o,a);',
    replace: 'const o=window.ApexGfx?window.ApexGfx.merge(r,vu.ec):vu.ec(r),c=new M.eaF(o,a);',
  },
  // Each part is built once per part colour (Summer, Winter, Desert) as the game loads. The circuits are huge and
  // only ever placed in one: their other colours are built the first time a track asks for them (ApexGfx.LazyMap:
  // a Map whose get() builds what was deferred). The game only gets a colour's mesh for parts placed in it.
  {
    name: 'part colours are kept in a map that can build them later',
    find: 'colors:new Map(e.colors.map((({id:e})=>[e,null]))),physicsShapeVertices:null};',
    replace: 'colors:new(window.ApexGfx&&window.ApexGfx.LazyMap||Map)(e.colors.map((({id:e})=>[e,null]))),physicsShapeVertices:null};',
  },
  {
    name: 'a part colour is built by a function of its own',
    find: 'let l=null;for(const n of e.colors){const i=[];',
    replace: 'let l=null;const apexColour=n=>{const i=[],apexHidden=[];',
  },
  {
    name: 'the circuits\' other colours are built when a track needs them',
    find: 'c=new M.eaF(o,a);t.colors.set(n.id,c),l??(l=r)}if(null==l)',
    replace: 'c=new M.eaF(o,a);return[c,r]};for(const n of e.colors){if(null!=l&&t.colors.defer&&window.ApexGfx.deferColour(l)){t.colors.defer(n.id,()=>apexColour(n)[0]);continue}const[c,r]=apexColour(n);t.colors.set(n.id,c),l??(l=r)}if(null==l)',
  },
  {
    // meshes whose name ends with "Invisible" (the wall closing Forest Speedway's pit lane) are solid but not drawn:
    // left out of the part's mesh, added to what the physics collides with
    name: 'a part\'s invisible meshes are not drawn',
    find: 'for(const t of e)i.push(t)}const r=vu.pP(i,!0)',
    replace: 'for(const t of e)(/Invisible$/.test(r)?apexHidden:i).push(t)}const r=vu.pP(i,!0)',
  },
  {
    name: 'a part\'s invisible meshes are added to what the physics collides with',
    find: 'c=new M.eaF(o,a);return[c,r]};',
    replace: 'c=new M.eaF(o,a);if(apexHidden.length){const v=[r.attributes.position.array,...apexHidden.map((e=>(e.index?e.toNonIndexed():e).attributes.position.array))],p=new Float32Array(v.reduce(((e,t)=>e+t.length),0));let k=0;for(const e of v)p.set(e,k),k+=e.length;return[c,{attributes:{position:new M.THS(p,3)}}]}return[c,r]};',
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
  // A circuit with land of its own, solid (Forest Speedway, tools/make_circuit.js), has no mountains at all: the game's
  // ring of them, hidden under its scenery, would still stand across its road and its land as invisible hills. The
  // track's bounds say so (from its parts); the game, and the check of records, make the mountains from them.
  {
    name: 'a track whose circuit brings its own land has its bounds say so',
    find: 'getBounds(){let e=1/0,t=1/0,n=-1/0,i=-1/0;return this.forEachPart(',
    replace: 'getBounds(){const apexBounds=this.apexBounds();let apexLand=!1;return this.forEachPart(((e,t,n,i)=>{apexLand=apexLand||' + JSON.stringify(CIRCUITS.filter(c => c.data.terrain).map(c => c.data.ids.road)) + '.includes(i)})),apexLand&&(apexBounds.apexOwnLand=!0),apexBounds}'
      + 'apexBounds(){let e=1/0,t=1/0,n=-1/0,i=-1/0;return this.forEachPart(',
  },
  {
    // the track being played keeps its own bounds, from its parts as they are placed (what makes the mountains in the game)
    name: 'a track being played whose circuit brings its own land has its bounds say so',
    find: 'Number.isFinite(e)&&Number.isFinite(t)&&Number.isFinite(n)&&Number.isFinite(i)?(0,A.GG)(this,d,{min:new y.I9Y(e,t),max:new y.I9Y(n,i)},"f"):(0,A.GG)(this,d,{min:new y.I9Y,max:new y.I9Y},"f")',
    replace: 'Number.isFinite(e)&&Number.isFinite(t)&&Number.isFinite(n)&&Number.isFinite(i)?(0,A.GG)(this,d,{min:new y.I9Y(e,t),max:new y.I9Y(n,i)},"f"):(0,A.GG)(this,d,{min:new y.I9Y,max:new y.I9Y},"f");'
      + 'for(const r of(0,A.gn)(this,l,"f"))' + JSON.stringify(CIRCUITS.filter(c => c.data.terrain).map(c => c.data.ids.road)) + '.includes(r.trackPartData?.configuration?.id)&&((0,A.gn)(this,d,"f").apexOwnLand=!0)',
  },
  {
    name: 'no mountains round a circuit that brings its own land',
    find: 'static createMountainVertices(e){const t=new h,',
    replace: 'static createMountainVertices(e){if(e.apexOwnLand)return{vertices:[],offset:new o.Pq0};const t=new h,',
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
    replace: CIRCUITS.map(({ name, data, sums, start }) => {
      const cell = '[[[-2,0,-2],[1,0,1]]]';
      const detector = type => '{type:o.A.' + type + ',center:[0,3.5,0],size:[' + data.gateWidth + ',7,1]}';
      const roadTiles = JSON.stringify(data.roadCells.map(([i, j]) => [[4 * i - 2, 0, 4 * j - 2], [4 * i + 1, 0, 4 * j + 1]]));
      // the road may have walls nobody sees, in a mesh of its own (tools/make_circuit.js)
      const part = (kind, id, rest) => ',new d(' + JSON.stringify(sums[id] || '') + ',r.A.Special,' + id + ',[["' + name + '","' + name + kind + '"]' + (kind === 'Road' && data.hidden ? ',["' + name + '","' + name + 'RoadInvisible"]' : '') + '],c,' + rest + ')';
      return part('Road', data.ids.road, roadTiles) + part('Start', data.ids.start, cell + ',null,new i.Pq0(0,' + (start ?? 0.35) + ',0)')
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
    // + the account hosting, if logged in: its friends see the room and can join it (apex-account.js);
    // the room list (apex-lobby.js) keeps the socket, to tell the server what the room is about
    replace: 'createMultiplayerHostWebSocket(){const apexSocket=new WebSocket(' + JSON.stringify(SERVER_URL + 'multiplayer/host' + SERVER_QUERY) + '+(window.ApexAccount?window.ApexAccount.hostQuery():""));return window.ApexLobby?window.ApexLobby.hostSocket(apexSocket):apexSocket}',
  },
  {
    name: 'rooms are joined through the GoofyTrack server',
    find: 'createMultiplayerJoinWebSocket(){if(this.determinismState!=Mo.Ok)throw new Error("WebSocket creation not allowed with non-deterministic physics");return new WebSocket("https://vps.kodub.com/"+(0,R.gn)(this,Af,"f")+"multiplayer/join")}',
    // apex-lobby.js notes the code joined: friends can follow the player into that room
    replace: 'createMultiplayerJoinWebSocket(){const apexSocket=new WebSocket(' + JSON.stringify(SERVER_URL + 'multiplayer/join' + SERVER_QUERY) + ');return window.ApexLobby?window.ApexLobby.joinSocket(apexSocket):apexSocket}',
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

  // ---------------------------------------------------------------- account (apex-account.js)
  {
    // the save of the account logged in comes down before the game reads its own (a few seconds at most):
    // after the storage is open and migrated to the current format, before the profiles and settings are read
    name: 'account save synced as the game starts',
    find: 'const e=new nf;await e.initialize(),e.migrate();',
    replace: 'const e=new nf;await e.initialize(),e.migrate(),await(window.ApexAccount&&window.ApexAccount.ready());',
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
  // ---------------------------------------------------------------- profile editor (apex-account.js)
  {
    // the profiles (name, flag, car) and the PolyTrack server they are sent to: the profile card edits the
    // name and flag through them, from the home screen, as the game's own window would
    name: 'the profile card reaches the game\'s profiles',
    find: 'S.syncUserProfile(T);',
    replace: 'S.syncUserProfile(T),window.GoofyGame={profiles:S,api:T};',
  },
  // ---------------------------------------------------------------- the mod's car patterns (build_patterns.js)
  {
    name: 'the mod\'s patterns follow the game\'s',
    find: 'e[15]={url:"images/pattern_outline.svg"},',
    replace: 'e[15]={url:"images/pattern_outline.svg"},' + MOD_PATTERNS.map((name, i) => 'e[' + (16 + i) + ']={url:"images/pattern_' + name + '.svg"},').join(''),
  },
  // ---------------------------------------------------------------- wings (build_car.js, apex-livery.js)
  // The car style gets a wing (its model, Wing0..) and a wing colour, null while the wings take the pattern
  // and the primary colour as before. Saved in 4 more bytes (16-18 the colour, 19 the wing, its high bit set
  // when the colour is the wing's own): a style with the standard wing painted like the body is written as
  // before, 16 bytes, so cars and records saved before stay the same. The game reads the extra bytes when
  // they are there; multiplayer sends all 20 (binaryLength), which every player of this build reads.
  // The body (build_car.js: 0 the car's own, 1.. the icons') follows in byte 20: a car with the car's own body is
  // saved in 16 or 20 bytes as before.
  {
    name: 'car style: wing fields',
    find: 'this.pattern=e,this.rims=t,this.exhaust=n,',
    replace: 'this.pattern=e,this.rims=t,this.exhaust=n,this.wing=0,this.wingHex=null,this.body=0,',
  },
  {
    name: 'car style: an icon\'s pattern keeps its colours',
    find: 'get primaryColor(){return new h.Q1f((0,c.gn)(this,r,"f"))}get secondaryColor(){return new h.Q1f((0,c.gn)(this,a,"f"))}',
    replace: 'get primaryColor(){return new h.Q1f(i.iconOf(this.pattern)?.[0]??(0,c.gn)(this,r,"f"))}get secondaryColor(){return new h.Q1f(i.iconOf(this.pattern)?.[1]??(0,c.gn)(this,a,"f"))}',
  },
  {
    name: 'car style: wing colour',
    find: 'get rimsColor(){return new h.Q1f((0,c.gn)(this,o,"f"))}',
    replace: 'get rimsColor(){return new h.Q1f((0,c.gn)(this,o,"f"))}get wingColor(){return new h.Q1f(i.iconOf(this.pattern)?.[0]??this.wingHex??(0,c.gn)(this,r,"f"))}',
  },
  {
    name: 'car style: equals with the wing',
    find: 'this.rimsHex==e.rimsHex}',
    replace: 'this.rimsHex==e.rimsHex&&this.wing==e.wing&&this.wingHex==e.wingHex&&this.body==e.body}',
  },
  {
    name: 'car style: clone with the wing',
    find: 'clone(){return new i(this.pattern,this.rims,this.exhaust,(0,c.gn)(this,r,"f"),(0,c.gn)(this,a,"f"),(0,c.gn)(this,s,"f"),(0,c.gn)(this,o,"f"))}',
    replace: 'clone(){const e=new i(this.pattern,this.rims,this.exhaust,(0,c.gn)(this,r,"f"),(0,c.gn)(this,a,"f"),(0,c.gn)(this,s,"f"),(0,c.gn)(this,o,"f"));return e.wing=this.wing,e.wingHex=this.wingHex,e.body=this.body,e}',
  },
  {
    name: 'car style: saved as before without a wing of its own',
    find: 'serialize(){return d.l(this.serializeBinary())}',
    replace: 'serialize(){const e=this.serializeBinary();return d.l(0!=this.body?e:0==this.wing&&null==this.wingHex?e.subarray(0,16):e.subarray(0,20))}',
  },
  {
    name: 'car style: wing bytes',
    find: '(0,c.gn)(this,o,"f")>>16&255],13),e}',
    replace: '(0,c.gn)(this,o,"f")>>16&255],13),e.set([255&(this.wingHex??0),(this.wingHex??0)>>8&255,(this.wingHex??0)>>16&255,this.wing|(null==this.wingHex?0:128),this.body],16),e}',
  },
  {
    name: 'car style: reads styles saved without a wing',
    find: 'if(e.length<i.binaryLength)throw new Error("Data length is too short")',
    replace: 'if(e.length<16)throw new Error("Data length is too short")',
  },
  {
    name: 'car style: reads the wing',
    find: 'return new i(t,n,r,a,s,o,l)}static get defaultPattern',
    replace: 'const W=new i(t,n,r,a,s,o,l);return e.length>=20&&(W.wing=i.isValidWing(127&e[19])?127&e[19]:0,W.wingHex=128&e[19]?e[16]|e[17]<<8|e[18]<<16:null),e.length>=21&&(W.body=i.isValidBody(e[20])?e[20]:0),W}static get defaultPattern',
  },
  {
    name: 'car style: valid wings',
    find: 'static isValidExhaust(e){return Number.isSafeInteger(e)&&e>=0&&e<i.exhausts.length}',
    replace: 'static isValidExhaust(e){return Number.isSafeInteger(e)&&e>=0&&e<i.exhausts.length}static isValidWing(e){return Number.isSafeInteger(e)&&e>=0&&e<i.wings.length}'
      + 'static isValidBody(e){return Number.isSafeInteger(e)&&e>=0&&e<i.bodies.length}static iconOf(e){return ' + ICON_COLOURS + '[e]??null}static isIcon(e){return null!=i.iconOf(e)}',
  },
  {
    name: 'car style: the wing models',
    find: 'u.binaryLength=16,',
    replace: 'u.binaryLength=21,u.wings=Object.freeze(Array.from({length:' + WING_COUNT + '},((e,t)=>Object.freeze({model:"Wing"+t})))),'
      + 'u.bodies=Object.freeze(Array.from({length:' + BODY_COUNT + '},((e,t)=>Object.freeze({model:0==t?"Body":"Body"+t})))),',
  },
  {
    name: 'car style: the mod\'s rims',
    find: 'e[11]={model:"Wheel11"},',
    replace: 'e[11]={model:"Wheel11"},' + Array.from({ length: MOD_RIMS }, (_, i) => 'e[' + (12 + i) + ']={model:"Wheel' + (12 + i) + '"},').join(''),
  },
  {
    name: 'car style: the mod\'s exhausts',
    find: 'e[7]={model:"Exhaust7"},',
    replace: 'e[7]={model:"Exhaust7"},' + Array.from({ length: MOD_EXHAUSTS }, (_, i) => 'e[' + (8 + i) + ']={model:"Exhaust' + (8 + i) + '"},').join(''),
  },
  {
    name: 'car: loads the wings',
    find: 'B.models={chassis:r(i("Body",!0)),suspension:r(i("Suspension",!0)),rims:a,exhausts:s,',
    replace: 'const W=new Map;for(let e=0;e<w.A.wings.length;e++)W.set(e,r(i(w.A.wings[e].model,!0)));const Bd=new Map;for(let e=0;e<w.A.bodies.length;e++)Bd.set(e,r(i(w.A.bodies[e].model,!0)));'
      + 'B.models={chassis:r(i("Body",!0)),suspension:r(i("Suspension",!0)),rims:a,exhausts:s,wings:W,bodies:Bd,',
  },
  {
    // on the chassis like the exhaust, after it: the wing's brake light is the one the game lights. The body is
    // the chassis' geometry and materials, swapped (the exhaust and the wing stay on it)
    name: 'car: puts its wing on',
    find: '(0,l.gn)(this,ye,"f").add((0,l.gn)(this,we,"f"));for(const e of(0,l.gn)(this,xe,"f"))(0,l.gn)(this,me,"f").add(e);',
    replace: '(0,l.gn)(this,ye,"f").add((0,l.gn)(this,we,"f")),this.apxWingMix={value:1},this.apxWing=B.models.wings.get((0,l.gn)(this,Me,"f").wing).clone(),(0,l.gn)(this,D,"m",We).call(this,this.apxWing),(0,l.gn)(this,ye,"f").add(this.apxWing),'
      + 'this.apxSetBody=e=>{const t=B.models.bodies.get(e).clone();(0,l.gn)(this,D,"m",We).call(this,t);const n=(0,l.gn)(this,ye,"f");(0,l.gn)(this,ge,"f").removeMaterial(n.material),n.geometry=t.geometry,n.material=t.material},'
      + '0!=(0,l.gn)(this,Me,"f").body&&this.apxSetBody((0,l.gn)(this,Me,"f").body);for(const e of(0,l.gn)(this,xe,"f"))(0,l.gn)(this,me,"f").add(e);',
  },
  {
    name: 'car: changes its wing and paints it',
    find: '(0,l.gn)(this,Ee,"f").value=(new c.Pq0).setFromColor(e.secondaryColor),(0,l.gn)(this,me,"f").traverse((t=>{if(t instanceof c.eaF){let n;n=Array.isArray(t.material)?t.material:[t.material];for(const t of n)"Main"==t.name?t.color.set(e.primaryColor):',
    replace: 'e.wing!=(0,l.gn)(this,Me,"f").wing&&((0,l.gn)(this,ye,"f").remove(this.apxWing),(0,l.gn)(this,ge,"f").removeMaterial(this.apxWing.material),this.apxWing=B.models.wings.get(e.wing).clone(),(0,l.gn)(this,D,"m",We).call(this,this.apxWing),(0,l.gn)(this,ye,"f").add(this.apxWing)),'
      + 'e.body!=(0,l.gn)(this,Me,"f").body&&(this.apxSetBody(e.body),null!=(0,l.gn)(this,O,"f")&&((0,l.gn)(this,O,"f").source.stop(),(0,l.GG)(this,O,null,"f"))),this.apxWingMix.value=null==e.wingHex||e.constructor.isIcon(e.pattern)?1:0,'
      + '(0,l.gn)(this,Ee,"f").value=(new c.Pq0).setFromColor(e.secondaryColor),(0,l.gn)(this,me,"f").traverse((t=>{if(t instanceof c.eaF){let n;n=Array.isArray(t.material)?t.material:[t.material];for(const t of n)"Main"==t.name?t.color.set(e.primaryColor):"Wing"==t.name?t.color.set(e.wingColor):',
  },
  {
    // the body's paint, with the pattern left out (carWingPattern 0) when the wing has a colour of its own;
    // a function of its own, as three.js shares the programs of materials whose onBeforeCompile reads the same
    name: 'car: the wing material',
    find: 'for(const e of t)if("Main"==e.name){if(!(e instanceof c._4j))throw new Error("Main material must be MeshStandardMaterial");',
    replace: 'for(const e of t)if("Wing"==e.name)e.onBeforeCompile=e=>{e.fragmentShader="uniform sampler2D carColorPattern;\\nuniform vec3 carColorSecondary;\\nuniform float carWingPattern;\\n"+e.fragmentShader,'
      + 'e.fragmentShader=e.fragmentShader.replace("vec4 diffuseColor = vec4( diffuse, opacity );","' + shade(' * carWingPattern') + '"),'
      + 'e.uniforms.carColorPattern=(0,l.gn)(this,Te,"f"),e.uniforms.carColorSecondary=(0,l.gn)(this,Ee,"f"),e.uniforms.carWingPattern=this.apxWingMix,e.defines??(e.defines={}),e.defines.USE_UV=!0},e.needsUpdate=!0;'
      + 'else if("Main"==e.name){if(!(e instanceof c._4j))throw new Error("Main material must be MeshStandardMaterial");',
  },
  {
    name: 'car: the body\'s paint has the patterns\' inks',
    find: '"float colorSource = texture(carColorPattern, vUv).g;\\nvec4 diffuseColor = vec4( carColorSecondary * colorSource + diffuse * (1.0 - colorSource), opacity );"',
    replace: '"' + shade('') + '"',
  },
  // ---------------------------------------------------------------- the engine's sound by body (ENGINE_SOUNDS)
  {
    name: 'the bodies\' engine sounds are loaded',
    find: 'l.load("engine",["audio/engine.ogg","audio/engine.mp3"]),',
    replace: 'l.load("engine",["audio/engine.ogg","audio/engine.mp3"]),' + Object.values(ENGINE_SOUNDS).map(name => 'l.load("' + name + '",["audio/' + name + '.wav"]),').join(''),
  },
  {
    // (the body changing, the sound playing stops: setCarStyle above, and starts again with the new one)
    name: 'a body has its engine\'s sound',
    find: 'const e=(0,l.gn)(this,G,"f").getBuffer("engine");if(null!=e&&null!=(0,l.gn)(this,G,"f").context){',
    replace: 'const e=(0,l.gn)(this,G,"f").getBuffer(' + JSON.stringify(ENGINE_SOUNDS) + '[(0,l.gn)(this,Me,"f").body]??"engine")??(0,l.gn)(this,G,"f").getBuffer("engine");if(null!=e&&null!=(0,l.gn)(this,G,"f").context){',
  },
  {
    name: 'car: the tyres\' lettering follows the rims',
    find: '"Rim"==t.name&&t.color.set(e.rimsColor)',
    replace: '"Rim"==t.name?t.color.set(e.rimsColor):"TireText"==t.name&&t.color.set(' + LETTERING('e.rimsHex') + ')',
  },
  // ---------------------------------------------------------------- lettered tyres (build_car.js, TURNED_RIMS)
  {
    name: 'car: lettered rims are turned round rather than mirrored',
    find: '(0,l.gn)(this,D,"m",We).call(this,t);return(1==e||3==e)&&(t.scale.x=-1),t}',
    replace: '(0,l.gn)(this,D,"m",We).call(this,t);return(1==e||3==e)&&(' + JSON.stringify(TURNED_RIMS) + '.includes((0,l.gn)(this,Me,"f").rims)?(t.apxTurn=!0,t.quaternion.setFromAxisAngle(new c.Pq0(0,1,0),Math.PI)):t.scale.x=-1),t}',
  },
  {
    name: 'car: lettered rims, when the rims change',
    find: 'i.position.copy(n.position),i.quaternion.copy(n.quaternion),i.scale.copy(n.scale),',
    replace: 'i.position.copy(n.position),i.quaternion.copy(n.quaternion),i.apxTurn=(1==t||3==t)&&' + JSON.stringify(TURNED_RIMS) + '.includes(e.rims),!!n.apxTurn!=i.apxTurn&&i.quaternion.multiply((new c.PTz).setFromAxisAngle(new c.Pq0(0,1,0),Math.PI)),i.scale.x=(1==t||3==t)&&!i.apxTurn?-1:1,',
  },
  {
    name: 'car: lettered rims turn with the wheel',
    find: 'o.multiply((new c.PTz).setFromAxisAngle(new c.Pq0(1,0,0),(0,l.gn)(this,pe,"f")[i])),',
    replace: 'o.multiply((new c.PTz).setFromAxisAngle(new c.Pq0(1,0,0),(0,l.gn)(this,pe,"f")[i])),(0,l.gn)(this,xe,"f")[i].apxTurn&&o.multiply((new c.PTz).setFromAxisAngle(new c.Pq0(0,1,0),Math.PI)),',
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
    name: 'collision and gravel code are loaded next to the physics',
    find: 'importScripts("lib/polytrack_physics.js");',
    replace: 'importScripts("lib/polytrack_physics.js","apex-collide.js","apex-sand.js");',
  },
  {
    name: 'the worker receives the other cars from the page',
    find: 'function r(i){const r=i.data;switch(r.messageType){case Ki.Init:',
    replace: 'function r(i){const r=i.data;if(self.ApexCollide&&self.ApexCollide.message(r))return;switch(r.messageType){case Ki.Init:',
  },
  {
    name: 'cars are tested against each other after every physics step',
    find: '[e.id,r.up,r.right,r.down,r.left,r.reset,i]);return new Uint8Array(t.HEAPU8.buffer,i,227).slice().buffer}',
    replace: '[e.id,r.up,r.right,r.down,r.left,r.reset,i]);self.ApexCollide&&self.ApexCollide.afterStep(t,e,i);self.ApexSand&&self.ApexSand.afterStep(t,e,i);return new Uint8Array(t.HEAPU8.buffer,i,227).slice().buffer}',
  },
  // ---- gravel traps (apex-sand.js)
  {
    name: 'a car in the gravel has its controls filtered before each physics step',
    find: 'function n(e,r){t.ccall("updateCarModel"',
    replace: 'function n(e,r){self.ApexSand&&(r=self.ApexSand.controls(e,r));t.ccall("updateCarModel"',
  },
  {
    name: 'the gravel code learns where the circuit of each new car is',
    find: 'function s(e,i,r,s,n){const a=t.ccall("malloc"',
    replace: 'function s(e,i,r,s,n){self.ApexSand&&self.ApexSand.car(e,s);const a=t.ccall("malloc"',
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
    replace: CIRCUITS.map(({ name, data, start }) => {
      const cell = '[[[-2,0,-2],[1,0,1]]]';
      const detector = type => '{type:to.' + type + ',center:[0,3.5,0],size:[' + data.gateWidth + ',7,1]}';
      const part = (kind, id, rest) => ',new lo("",Xa.Special,' + id + ',[["' + name + '","' + name + kind + '"]],ao,' + cell + rest + ')';
      return part('Road', data.ids.road, '') + part('Start', data.ids.start, ',null,new R(0,' + (start ?? 0.35) + ',0)')
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

// The garage is a chunk of its own: it only paints the car, with three liveries (apex-livery.js). The name
// and flag are the profile card's (apex-account.js), and so is switching profile.
const LIVERY = 'window.ApexLivery';
const garagePatches = [
  {
    name: 'garage Save saves the car, without the name and flag window',
    find: 'v.addEventListener("click",(()=>{a.playUIClick(),(0,i.gn)(this,jn,"f").classList.add("hidden"),(0,i.gn)(this,Wn,"m",he).call(this,(0,i.gn)(this,ne,"f"),(0,i.gn)(this,ie,"f"),(0,i.gn)(this,se,"f"),(()=>{(0,i.gn)(this,jn,"f").classList.remove("hidden"),(0,i.gn)(this,Wn,"m",pe).call(this)}))}))',
    replace: 'v.addEventListener("click",(()=>{a.playUIClick(),(0,i.gn)(this,Wn,"m",pe).call(this)}))',
  },
  {
    name: 'Switch Profile becomes Liveries',
    find: 'x.append(document.createTextNode(e.get("Switch Profile"))),x.addEventListener("click",(()=>{a.playUIClick(),xn.Xx()||(',
    replace: 'x.append(document.createTextNode(' + LIVERY + '?' + LIVERY + '.label():e.get("Switch Profile"))),x.addEventListener("click",(()=>{a.playUIClick(),xn.Xx()||' + LIVERY + '&&' + LIVERY + '.open()||(',
  },
  {
    name: 'the car saved is the livery picked',
    find: '(0,i.GG)(this,oe,!1,"f"),(0,i.GG)(this,ae,!0,"f")),(0,i.gn)(this,Dn,"f").tryActivatePersistentStorage()',
    replace: '(0,i.GG)(this,oe,!1,"f"),(0,i.GG)(this,ae,!0,"f"),' + LIVERY + '&&' + LIVERY + '.saved((0,i.gn)(this,ee,"f").token,(0,i.gn)(this,ee,"f").carStyle.serialize())),(0,i.gn)(this,Dn,"f").tryActivatePersistentStorage()',
  },
  {
    name: 'the cars parked beside the player\'s are the other liveries',
    find: 'const n=(0,i.gn)(this,Tn,"f")[t],e=(0,i.gn)(this,Hn,"f").getUserProfile(t);',
    replace: 'const n=(0,i.gn)(this,Tn,"f")[t];if(' + LIVERY + '){const e=' + LIVERY + '.parked(t);null!=e?(n.setCarStyle(y.A.deserializeSafe(e)),n.setVisible(!0)):n.setVisible(!1);continue}const e=(0,i.gn)(this,Hn,"f").getUserProfile(t);',
  },
  {
    // in the constructor, y is a button: the car style class comes from the car itself
    name: 'the garage hands its car to the liveries',
    find: '(0,i.gn)(this,Wn,"m",re).call(this),(0,i.GG)(this,oe,!1,"f")}dispose(){',
    replace: '(0,i.gn)(this,Wn,"m",re).call(this),(0,i.GG)(this,oe,!1,"f"),' + LIVERY + '&&' + LIVERY + '.garage({'
      + 'get:()=>(0,i.gn)(this,Sn,"f").getCarStyle().serialize(),'
      + 'set:t=>{const n=(0,i.gn)(this,Sn,"f").getCarStyle().constructor.deserializeSafe(t);(0,i.gn)(this,te,"f").setCarStyle(n),(0,i.gn)(this,Sn,"f").setCarStyle(n),(0,i.GG)(this,oe,!0,"f")},'
      + 'save:()=>(0,i.gn)(this,Wn,"m",pe).call(this),dirty:()=>(0,i.gn)(this,oe,"f"),parked:()=>(0,i.gn)(this,Wn,"m",re).call(this),click:()=>a.playUIClick()})'
      + '}dispose(){' + LIVERY + '&&' + LIVERY + '.garage(null);',
  },
  // the wing colour: a fifth picker under Paint, beside Primary and Secondary, following the pattern until it is
  // moved (apex-livery.js keeps that state on the panel: apxWing, apxWingHex)
  {
    name: 'wing colour picker',
    find: '(0,i.gn)(this,Yt,"m",bn).call(this,n.get("Rims"),g),',
    replace: '(0,i.gn)(this,Yt,"m",bn).call(this,n.get("Rims"),g),(0,i.gn)(this,Yt,"m",bn).call(this,' + LIVERY + '?' + LIVERY + '.wingLabel():"Wing",d),' + LIVERY + '&&' + LIVERY + '.wingPicker(this,d.lastChild,(0,i.gn)(this,cn,"f")[4]),',
  },
  {
    name: 'the car built by the panel has its wing',
    find: '(0,i.gn)(this,cn,"f")[3].color.getHex());(0,i.gn)(this,rn,"f").call(this,t)}',
    replace: '(0,i.gn)(this,cn,"f")[3].color.getHex());' + LIVERY + '&&' + LIVERY + '.wingStyle(this,t,(0,i.gn)(this,cn,"f")[4]),(0,i.gn)(this,rn,"f").call(this,t)}',
  },
  {
    name: 'the panel shows the wing of the car',
    find: 'setCarStyle(t){(0,i.GG)(this,Kt,t.pattern,"f"),',
    replace: 'setCarStyle(t){this.apxWing=t.wing??0,this.apxWingHex=t.wingHex??null,this.apxWingShown=null,this.apxWingSelect&&this.apxWingSelect(),(0,i.GG)(this,Kt,t.pattern,"f"),',
  },
  {
    name: 'the wing picker shows the wing colour',
    find: '(0,i.gn)(this,cn,"f")[3].color=t.rimsColor}}',
    replace: '(0,i.gn)(this,cn,"f")[3].color=t.rimsColor,' + LIVERY + '&&' + LIVERY + '.wingShow(this,t,(0,i.gn)(this,cn,"f")[4])}}',
  },
  {
    // the Wing tab, made like the Exhaust one: dark car, light wings
    name: 'Wing tab',
    find: 'const f=[{title:n.get("Paint"),icon:"images/paint.svg",panel:h},',
    replace: '{const W=document.createElement("div");W.className="panel options-panel hidden",(0,i.gn)(this,Jt,"f").appendChild(W),this.apxWingPanel=W,this.apxWingTiles=new Map;'
      + 'for(let o=0;o<y.A.wings.length;o++){const l=document.createElement("button");l.addEventListener("click",(()=>{t.playUIClick(),this.apxWing=o,this.apxWingSelect(),(0,i.gn)(this,Yt,"m",dn).call(this)})),o==(this.apxWing??0)&&l.classList.add("selected"),W.appendChild(l),window.ApexRarity&&window.ApexRarity.item("wing",l,o);'
      + 'const q=new y.A(y.A.defaultPattern,y.A.defaultRims,y.A.defaultExhaust,2236962,2236962,1250067,6710886);q.wing=o,q.wingHex=15658734;const m=document.createElement("img");m.className="loading",kt.F(q,(0,i.gn)(this,hn,"f"),{position:new s.Pq0(-1e3,900,-1e3),look:new s.Pq0(0,.1,0),zoom:.6}).then((t=>{m.src=t,m.classList.remove("loading")})),l.appendChild(m),this.apxWingTiles.set(o,l)}'
      + 'this.apxWingSelect=()=>{for(const[t,n]of this.apxWingTiles)t==(this.apxWing??0)?n.classList.add("selected"):n.classList.remove("selected")},this.apxWingScroll=()=>{const t=this.apxWingTiles.get(this.apxWing??0);null!=t&&(0,i.gn)(_t,_t,"m",wn).call(_t,W,t)}}'
      + 'const f=[{title:n.get("Paint"),icon:"images/paint.svg",panel:h},',
  },
  {
    name: 'Wing tab button',
    find: '{title:n.get("Exhaust"),icon:"images/exhaust.svg",panel:(0,i.gn)(this,an,"f")}]',
    replace: '{title:n.get("Exhaust"),icon:"images/exhaust.svg",panel:(0,i.gn)(this,an,"f")},{title:' + LIVERY + '?' + LIVERY + '.wingLabel():"Wing",icon:"images/wing.svg",panel:this.apxWingPanel}]',
  },
  {
    name: 'Wing tab hidden with the others',
    find: '(0,i.gn)(this,an,"f").classList.add("hidden"),e.classList.add("selected")',
    replace: '(0,i.gn)(this,an,"f").classList.add("hidden"),this.apxWingPanel.classList.add("hidden"),e.classList.add("selected")',
  },
  {
    name: 'Wing tab camera',
    find: 'n.panel==(0,i.gn)(this,an,"f")&&((0,i.gn)(this,Yt,"m",vn).call(this),c(new s.Pq0(2.874291197536667,.9837316369014955,-.7283975369068978)))',
    replace: 'n.panel==(0,i.gn)(this,an,"f")?((0,i.gn)(this,Yt,"m",vn).call(this),c(new s.Pq0(2.874291197536667,.9837316369014955,-.7283975369068978))):n.panel==this.apxWingPanel&&(this.apxWingScroll(),c(new s.Pq0(3.6,2.2,1.5)))',
  },
  // the Body tab, made like the Wing one (build_car.js: the car's own body, then the icons'); the panel keeps
  // apxBody, which apex-livery.js puts on the car it builds
  {
    name: 'Body tab',
    find: 'const f=[{title:n.get("Paint"),icon:"images/paint.svg",panel:h},',
    replace: '{const W=document.createElement("div");W.className="panel options-panel hidden",(0,i.gn)(this,Jt,"f").appendChild(W),this.apxBodyPanel=W,this.apxBodyTiles=new Map;'
      + 'for(let o=0;o<y.A.bodies.length;o++){const l=document.createElement("button");l.addEventListener("click",(()=>{t.playUIClick(),this.apxBody=o,this.apxBodySelect(),(0,i.gn)(this,Yt,"m",dn).call(this)})),o==(this.apxBody??0)&&l.classList.add("selected"),W.appendChild(l),window.ApexRarity&&window.ApexRarity.item("body",l,o);'
      + 'const q=new y.A(y.A.defaultPattern,y.A.defaultRims,y.A.defaultExhaust,15658734,2236962,1250067,6710886);q.body=o;const m=document.createElement("img");m.className="loading",kt.F(q,(0,i.gn)(this,hn,"f")).then((t=>{m.src=t,m.classList.remove("loading")})),l.appendChild(m),this.apxBodyTiles.set(o,l)}'
      + 'this.apxBodySelect=()=>{for(const[t,n]of this.apxBodyTiles)t==(this.apxBody??0)?n.classList.add("selected"):n.classList.remove("selected")},this.apxBodyScroll=()=>{const t=this.apxBodyTiles.get(this.apxBody??0);null!=t&&(0,i.gn)(_t,_t,"m",wn).call(_t,W,t)}}'
      + 'const f=[{title:n.get("Paint"),icon:"images/paint.svg",panel:h},',
  },
  {
    // first of the tabs; Paint is still the one open
    name: 'Body tab button',
    find: 'const f=[{title:n.get("Paint"),icon:"images/paint.svg",panel:h},',
    replace: 'const f=[{title:' + LIVERY + '?' + LIVERY + '.bodyLabel():"Body",icon:"images/body.svg",panel:this.apxBodyPanel},{title:n.get("Paint"),icon:"images/paint.svg",panel:h},',
  },
  {
    name: 'Paint is the tab open',
    find: 'let p=f[0];',
    replace: 'let p=f.find((e=>e.panel==h));',
  },
  {
    name: 'Paint is the tab picked',
    find: '0==u.length&&e.classList.add("selected")',
    replace: 'n.panel==h&&e.classList.add("selected")',
  },
  // the Random button leaves out the items not unlocked (apex-rarity.js)
  ...[['Pattern', 'pattern'], ['Rims', 'rims'], ['Exhaust', 'exhaust']].map(([game, kind]) => ({
    name: 'Random: ' + kind + ' unlocked',
    find: '.filter((t=>(0,i.gn)(this,Xn,"f").is' + game + 'Unlocked(t)))',
    replace: '.filter((t=>(0,i.gn)(this,Xn,"f").is' + game + 'Unlocked(t)&&(!window.ApexRarity||window.ApexRarity.owned("' + kind + '",t))))',
  })),
  {
    name: 'Body tab hidden with the others',
    find: 'this.apxWingPanel.classList.add("hidden"),',
    replace: 'this.apxWingPanel.classList.add("hidden"),this.apxBodyPanel.classList.add("hidden"),',
  },
  {
    name: 'Body tab camera',
    find: ':n.panel==this.apxWingPanel&&(this.apxWingScroll(),c(new s.Pq0(3.6,2.2,1.5)))',
    replace: ':n.panel==this.apxWingPanel?(this.apxWingScroll(),c(new s.Pq0(3.6,2.2,1.5))):n.panel==this.apxBodyPanel&&(this.apxBodyScroll(),c(new s.Pq0(2.6,1.4,4.4)))',
  },
  {
    // the colours picked, not the ones an icon's pattern shows (patch_bundle.js, ICONS): they come back with another pattern
    name: 'the pickers show the colours picked',
    find: '(0,i.gn)(this,cn,"f")[0].color=t.primaryColor,(0,i.gn)(this,cn,"f")[1].color=t.secondaryColor,',
    replace: '(0,i.gn)(this,cn,"f")[0].color=new s.Q1f(t.primaryHex),(0,i.gn)(this,cn,"f")[1].color=new s.Q1f(t.secondaryHex),',
  },
  {
    name: 'the panel shows the body of the car',
    find: 'setCarStyle(t){this.apxWing=t.wing??0,',
    replace: 'setCarStyle(t){this.apxBody=t.body??0,this.apxBodySelect&&this.apxBodySelect(),this.apxWing=t.wing??0,',
  },
  // each pattern, rims, exhaust and wing shows its name and rarity, the rarest at the bottom (apex-rarity.js)
  {
    name: 'pattern rarities',
    find: '(0,i.gn)(this,nn,"f").appendChild(a);',
    replace: '(0,i.gn)(this,nn,"f").appendChild(a),window.ApexRarity&&window.ApexRarity.item("pattern",a,s);',
  },
  {
    name: 'rims rarities',
    find: '(0,i.gn)(this,sn,"f").appendChild(l);',
    replace: '(0,i.gn)(this,sn,"f").appendChild(l),window.ApexRarity&&window.ApexRarity.item("rims",l,o);',
  },
  {
    name: 'exhaust rarities',
    find: '(0,i.gn)(this,an,"f").appendChild(l);',
    replace: '(0,i.gn)(this,an,"f").appendChild(l),window.ApexRarity&&window.ApexRarity.item("exhaust",l,o);',
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
applyPatches(GARAGE_CHUNK, garagePatches);
console.log(`Patched main.bundle.js (${patches.length} hooks), the physics worker (${workerPatches.length}), the editor (${editorPatches.length}) and the garage (${garagePatches.length}), build ${BUILD_ID}, server ${SERVER_URL}`);
