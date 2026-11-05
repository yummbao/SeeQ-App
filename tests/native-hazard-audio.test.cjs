/* global __dirname */
const {Buffer}=require('node:buffer');
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const ts=require('typescript');const React=require('react');const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
function compile(file,requireFn,extra={}){
 const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',...Object.keys(extra),code)(requireFn,module,module.exports,...Object.values(extra));return module.exports;
}
async function fixture(){
 const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost'});
 global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const order=[],players=[],spoken=[],logs=[],sockets=[],files=new Map(),cache=new Map();
 const clock={now:Date.now()};const LocalDate=class extends Date{static now(){return clock.now;}};
 let controller;let currentSpeech;let failMode=false;
 const speech={
  stop:()=>{order.push('speech-stop');const old=currentSpeech;currentSpeech=null;old?.options.onStopped?.();return Promise.resolve();},
  speak:(message,options)=>{order.push('tts:'+message);const entry={message,options};spoken.push(entry);currentSpeech=entry;},
 };
 class Socket{constructor(){this.readyState=1;this.sent=[];sockets.push(this);}send(data){this.sent.push(JSON.parse(data));}close(){this.closed=true;}}
 class LocalFile{
  constructor(_cache,name){this.uri='file:///local-cache/'+name;}
  get exists(){return files.has(this.uri);}get size(){return files.get(this.uri)?.length||0;}
  create(){files.set(this.uri,Buffer.alloc(0));}write(text){files.set(this.uri,Buffer.from(text,'base64'));}
 }
 const audio={
  setAudioModeAsync:async options=>{order.push('audio-mode');assert.equal(options.playsInSilentMode,true);if(failMode)throw Error('simulated iOS audio session error');},
  createAudioPlayer:(source,options)=>{
   assert.match(source.uri,/^file:/);assert.ok(files.has(source.uri));
   const listeners=new Set();
   const player={source,options,isLoaded:false,muted:true,volume:0,loop:true,
    addListener:(_name,listener)=>{listeners.add(listener);return{remove:()=>listeners.delete(listener)};},
    play:()=>{player.playCount=(player.playCount||0)+1;order.push('tone-play');},
    pause:()=>{order.push('tone-pause');},remove:()=>{player.removed=true;order.push('tone-remove');},
    emit:status=>{if(status.isLoaded!=null)player.isLoaded=status.isLoaded;for(const listener of [...listeners])listener({playbackState:'ready',playing:false,isLoaded:player.isLoaded,didJustFinish:false,...status});},
   };players.push(player);return player;
  },
 };
 const mocks={react:React,'expo-audio':audio,'expo-speech':speech,'expo-file-system':{File:LocalFile,Paths:{cache:'local-cache'}},
  'react-native':{Platform:{OS:'ios'},AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
  '@react-native-async-storage/async-storage':{__esModule:true,default:{getItem:async()=> 'ws://10.42.0.1:5000',setItem:async()=>{}}},
  '@/lib/platform/vibration':{Vibration:{vibrate:()=>order.push('vibrate'),cancel(){}}},
 };
 function load(file){
  if(cache.has(file))return cache.get(file);
  if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
  const result=compile(file,name=>{
   if(name in mocks)return mocks[name];
   if(name.startsWith('@/'))return load(name.slice(2)+(/\.(ts|json)$/.test(name)?'':'.ts'));
   if(name.startsWith('./'))return load(path.posix.join(path.posix.dirname(file),name)+(/\.(ts|json)$/.test(name)?'':'.ts'));
   return require(name);
  },{WebSocket:Socket,Date:LocalDate,console:{info:(...args)=>logs.push(args),warn:(...args)=>logs.push(args)}});
  cache.set(file,result);return result;
 }
 const {useHazardAlerts}=load('hooks/use-hazard-alerts.native.ts');
 function App(){controller=useHazardAlerts({allowed:true,onResumeGuidance:()=>order.push('guidance-resume')});return null;}
 const mounted=require('react-dom/client').createRoot(document.getElementById('root'));
 await React.act(async()=>{mounted.render(React.createElement(App));});
 assert.equal(sockets.length,1,'the real hook should subscribe to the socket');
 await React.act(async()=>sockets[0].onopen());
 assert.equal(sockets[0].sent[0].event,'TIME_SYNC','native connection sends clock sync before receiving alerts');
 assert.equal(sockets[0].sent[0].timestamp,clock.now/1000);
 return{
  get controller(){return controller;},order,players,spoken,logs,clock,
  modeFailure:()=>{failMode=true;},
  send:async(event,message='카메라가 보낸 원문')=>{clock.now+=1;await React.act(async()=>sockets.at(-1).onmessage({data:JSON.stringify({event,message,ttc:event==='LEVEL1'?1.2:null,timestamp:clock.now/1000})}));},
  sendAged:async(event,ageSeconds)=>{clock.now+=1;await React.act(async()=>sockets.at(-1).onmessage({data:JSON.stringify({event,message:'기존 감지 멘트',ttc:event==='LEVEL1'?1.2:null,timestamp:clock.now/1000-ageSeconds})}));},
  button:async event=>{clock.now+=1;await React.act(async()=>controller.test(event));},
  status:async(player,status)=>{await React.act(async()=>player.emit(status));},
  finishSpeech:async()=>{await React.act(async()=>{const old=currentSpeech;currentSpeech=null;old?.options.onDone?.();});},
  disconnect:async()=>{await React.act(async()=>sockets.at(-1).onclose());},
  close:async()=>{await React.act(async()=>mounted.unmount());dom.window.close();delete global.window;delete global.document;},
 };
}

const messages={LEVEL1:'전방 위험물 접근중! 즉시 정지하세요.',LEVEL2:'전방에 장애물이 있습니다.',CROSSWALK:'전방에 횡단보도. 빨간불입니다.',GO:'초록불이 감지되었습니다.'};
for(const mode of ['live','test'])for(const event of Object.keys(messages))test(`${mode} ${event}: the actual native hook waits for tone completion before its existing TTS`,async()=>{
 const f=await fixture();try{
  await (mode==='live'?f.send(event):f.button(event));
  if(event!=='GO'){
   assert.equal(f.players.length,1);const player=f.players[0];assert.equal(player.playCount,undefined,'must wait for load');assert.equal(f.spoken.length,0);
   await f.status(player,{isLoaded:true});assert.equal(player.playCount,1);assert.equal(player.muted,false);assert.equal(player.volume,1);assert.equal(player.loop,false);
   await f.status(player,{isLoaded:true,playing:true});assert.equal(f.spoken.length,0,'TTS must not overlap with a playing tone');
   await f.status(player,{didJustFinish:true});assert.ok(!player.removed,'iOS player must retain its session during TTS');assert.equal(player.options.keepAudioSessionActive,true);
   assert.ok(f.order.indexOf('tone-pause')<f.order.findIndex(value=>value.startsWith('tts:')),'audible tone stops before speech');
  }else assert.equal(f.players.length,0,'GO remains the existing speech-only event');
  assert.equal(f.spoken.length,1);assert.equal(f.spoken[0].message,(mode==='test'?'테스트. ':'')+messages[event]);
  await f.finishSpeech();
  if(event!=='GO')assert.ok(f.players[0].removed,'session is released after speech finishes');
 }finally{await f.close();}
});
test('native warning bytes are identical to existing WAVs and canonical policies are unchanged',()=>{
 const embedded=JSON.parse(fs.readFileSync(path.join(root,'assets/sounds/hazard-tones.json'),'utf8'));
 for(const [key,name]of[['level1','hazard-level1.wav'],['short','hazard-short.wav']]){
  const wav=fs.readFileSync(path.join(root,'assets/sounds',name));const bytes=Buffer.from(embedded[key].base64,'base64');
  assert.deepEqual(bytes,wav);assert.equal(bytes.length,embedded[key].size);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),embedded[key].sha256);
 }
 const policy=compile('lib/hazard-alert-policy.ts',require);
 assert.deepEqual(policy.HAZARD_TEST_MESSAGES,messages);assert.deepEqual(policy.HAZARD_TEST_TONES,{LEVEL1:'level1',LEVEL2:'short',CROSSWALK:'short',GO:null});
});
test('native player failure pauses the tone before fallback TTS and keeps the reason visible across frames',async()=>{
 const f=await fixture();try{
  await f.send('LEVEL1');const sound=f.players[0];await f.status(sound,{playbackState:'failed',reasonForWaitingToPlay:'decoder error'});
  assert.ok(!sound.removed);assert.ok(f.order.indexOf('tone-pause')<f.order.findIndex(value=>value.startsWith('tts:')));assert.equal(sound.options.keepAudioSessionActive,true);
  assert.equal(f.spoken[0].message,messages.LEVEL1);assert.match(f.controller.error,/decoder error/);
  await f.send('LEVEL1');assert.match(f.controller.error,/decoder error/,'valid socket frames must not erase the audio failure');
  assert.ok(f.logs.some(entry=>entry[1]?.phase==='tone-failed'&&entry[1].event==='LEVEL1'));
 }finally{await f.close();}
});
test('iOS audio session failure is diagnosed and still falls back to the existing message',async()=>{
 const f=await fixture();try{f.modeFailure();await f.send('LEVEL2');assert.equal(f.players.length,0);assert.equal(f.spoken[0].message,messages.LEVEL2);assert.match(f.controller.error,/audio session error/);}finally{await f.close();}
});
test('continuous same-level messages cannot restart a pending tone or starve speech, even beyond 3 seconds',async()=>{
 const f=await fixture();try{
  await f.send('LEVEL1');const first=f.players[0];await f.status(first,{isLoaded:true});
  f.clock.now+=4000;await f.send('LEVEL1','변경된 탐지 설명');await f.send('LEVEL1');assert.equal(f.players.length,1);
  await f.status(first,{didJustFinish:true});assert.equal(f.spoken[0].message,messages.LEVEL1);
  f.clock.now+=4000;await f.send('LEVEL1');assert.equal(f.players.length,1);assert.equal(f.spoken.length,1);
 }finally{await f.close();}
});
test('higher severity cancels lower tone and late callbacks cannot start stale TTS',async()=>{
 const f=await fixture();try{
  await f.send('LEVEL2');const old=f.players[0];await f.status(old,{isLoaded:true});
  await f.send('LEVEL1');assert.ok(old.removed);assert.equal(f.players.length,2);
  await f.status(old,{didJustFinish:true});assert.equal(f.spoken.length,0);
  const next=f.players[1];await f.status(next,{isLoaded:true});await f.status(next,{didJustFinish:true});assert.deepEqual(f.spoken.map(x=>x.message),[messages.LEVEL1]);
  await f.send('GO');assert.equal(f.spoken.length,1,'lower priority remains suppressed');
 }finally{await f.close();}
});
test('higher severity stops lower TTS before starting its warning tone',async()=>{
 const f=await fixture();try{
  await f.send('LEVEL2');await f.status(f.players[0],{isLoaded:true});await f.status(f.players[0],{didJustFinish:true});
  assert.equal(f.spoken[0].message,messages.LEVEL2);const before=f.order.length;
  await f.send('LEVEL1');await f.status(f.players[1],{isLoaded:true});
  const tail=f.order.slice(before);assert.ok(tail.indexOf('speech-stop')<tail.indexOf('tone-play'));
  await f.status(f.players[1],{didJustFinish:true});assert.equal(f.spoken.at(-1).message,messages.LEVEL1);
 }finally{await f.close();}
});
test('disconnect cancels a tone and cannot leak its TTS after cleanup',async()=>{
 const f=await fixture();try{await f.send('CROSSWALK');const sound=f.players[0];await f.status(sound,{isLoaded:true});await f.disconnect();assert.ok(sound.removed);await f.status(sound,{didJustFinish:true});assert.equal(f.spoken.length,0);}finally{await f.close();}
});
test('real JSON path is logged and unknown LEVEL3 is rejected without changing the protocol',async()=>{
 const f=await fixture();try{await f.send('LEVEL3');assert.equal(f.players.length,0);assert.equal(f.spoken.length,0);assert.ok(f.logs.some(x=>x[0]==='[SeeQ hazard receive]'&&x[1].raw.includes('LEVEL3')));}finally{await f.close();}
});
test('load timeout is a failure, not a fake playback completion',async()=>{
 const listeners=new Set();const stages=[];let cancel;
 const api=compile('lib/hazard-tone-player.ts',require);
 const player={isLoaded:false,addListener:(_event,fn)=>{listeners.add(fn);return{remove:()=>listeners.delete(fn)};},play:()=>assert.fail('not loaded'),muted:true,volume:0,loop:true};
 await assert.rejects(api.playHazardTone(player,{isCurrent:()=>true,registerCancel:value=>{cancel=value;},report:stage=>stages.push(stage),timeoutMs:5}),/로드하지 못/);
 assert.equal(listeners.size,0);assert.equal(cancel,null);assert.ok(!stages.includes('ended'));
});

test('changing JSON wording at the same level does not bypass cooldown after TTS completes',async()=>{
 const f=await fixture();try{
  await f.send('GO','첫 원문');await f.finishSpeech();await f.send('GO','바뀐 원문');assert.equal(f.spoken.length,1);
  f.clock.now+=3100;await f.send('GO','다른 원문');assert.equal(f.spoken.length,2);
 }finally{await f.close();}
});
test('disconnect while the file is loading never calls play or starts speech',async()=>{
 const f=await fixture();try{
  await f.send('LEVEL1');const player=f.players[0];await f.disconnect();await f.status(player,{isLoaded:true,didJustFinish:true});
  assert.equal(player.playCount,undefined);assert.equal(f.spoken.length,0);assert.ok(player.removed);
 }finally{await f.close();}
});
test('missing native finish event fails instead of treating a duration timer as a successful finish',async()=>{
 const listeners=new Set();let cancel;let plays=0;
 const {playHazardTone}=compile('lib/hazard-tone-player.ts',require);
 const player={isLoaded:true,muted:true,volume:0,loop:true,play:()=>{plays++;},addListener:(_name,fn)=>{listeners.add(fn);return{remove:()=>listeners.delete(fn)};}};
 await assert.rejects(playHazardTone(player,{isCurrent:()=>true,registerCancel:value=>{cancel=value;},report(){},timeoutMs:5}),/종료 이벤트/);
 assert.equal(plays,1);assert.equal(cancel,null);assert.equal(listeners.size,0);
});

test('all four test buttons work in order in the same session without waiting for the prior severity hold',async()=>{
 const f=await fixture();try{
  for(const event of ['LEVEL1','LEVEL2','CROSSWALK','GO']){
   const before=f.spoken.length;await f.button(event);
   if(event!=='GO'){
    const sound=f.players.at(-1);await f.status(sound,{isLoaded:true});assert.equal(f.spoken.length,before);
    await f.status(sound,{didJustFinish:true});assert.equal(sound.options.keepAudioSessionActive,true);assert.ok(!sound.removed);
   }
   assert.equal(f.spoken.length,before+1);assert.equal(f.spoken.at(-1).message,'테스트. '+messages[event]);
   await f.finishSpeech();if(event!=='GO')assert.ok(f.players.at(-1).removed);
  }
 }finally{await f.close();}
});
test('selecting another test during its short tone cancels stale speech and runs the newly selected test',async()=>{
 const f=await fixture();try{
  await f.button('LEVEL2');const first=f.players[0];await f.status(first,{isLoaded:true});
  await f.button('CROSSWALK');assert.ok(first.removed);assert.equal(f.players.length,2);
  await f.status(first,{didJustFinish:true});assert.equal(f.spoken.length,0);
  await f.status(f.players[1],{isLoaded:true});await f.status(f.players[1],{didJustFinish:true});assert.equal(f.spoken[0].message,'테스트. '+messages.CROSSWALK);
 }finally{await f.close();}
});
test('test selections still cannot interrupt a real warning',async()=>{
 const f=await fixture();try{
  await f.send('LEVEL1');await f.status(f.players[0],{isLoaded:true});await f.button('CROSSWALK');
  assert.equal(f.players.length,1);assert.match(f.controller.error,/실제 경고/);
  await f.status(f.players[0],{didJustFinish:true});assert.equal(f.spoken[0].message,messages.LEVEL1);
 }finally{await f.close();}
});
test('failure after playback starts pauses the tone but keeps the iOS session alive through fallback TTS',async()=>{
 const f=await fixture();try{
  await f.send('CROSSWALK');const sound=f.players[0];await f.status(sound,{isLoaded:true});
  await f.status(sound,{playbackState:'failed',reasonForWaitingToPlay:'simulated native failure'});
  assert.ok(!sound.removed);assert.equal(sound.options.keepAudioSessionActive,true);assert.equal(f.spoken[0].message,messages.CROSSWALK);
  assert.ok(f.order.indexOf('tone-pause')<f.order.findIndex(value=>value.startsWith('tts:')));
  await f.finishSpeech();assert.ok(sound.removed);
 }finally{await f.close();}
});

test('native screen/log reports both clocks for 2484s stale data and a following fresh LEVEL1 still plays tone then TTS',async()=>{
 const f=await fixture();try{
  await f.sendAged('LEVEL1',2484);
  assert.equal(f.players.length,0);assert.equal(f.spoken.length,0);
  assert.match(f.controller.error,/수신 진단: stale/);assert.match(f.controller.error,/아이폰 Date.now\(\) ms/);assert.ok(f.controller.error.includes(String(f.clock.now)));
  const timing=f.logs.find(entry=>entry[0]==='[SeeQ hazard receive]')[1];
  assert.equal(timing.receivedAtMs,f.clock.now);assert.equal(timing.ageSeconds,2484);assert.equal(timing.ageMs,2484000);assert.equal(timing.validatorTimestampMs,timing.timestampRaw*1000);
  await f.send('LEVEL1');assert.equal(f.players.length,1);assert.equal(f.controller.error,'');
  await f.status(f.players[0],{isLoaded:true});assert.equal(f.spoken.length,0);
  await f.status(f.players[0],{didJustFinish:true});assert.equal(f.spoken[0].message,messages.LEVEL1);await f.finishSpeech();
 }finally{await f.close();}
});
test('truncated cache writes are rejected with actual file size and never returned as valid audio',()=>{
 const tones={short:{filename:'short.wav',size:12,base64:'unused'}};
 class BrokenFile{constructor(){this.uri='file:///short.wav';this.exists=false;this.size=0;}create(){this.exists=true;}write(){this.size=3;}}
 const api=compile('lib/hazard-sounds.native.ts',name=>{
  if(name==='expo-file-system')return{File:BrokenFile,Paths:{cache:'cache'}};
  if(name==='@/assets/sounds/hazard-tones.json')return tones;
  throw Error(name);
 });
 assert.throws(()=>api.getHazardSoundUri('short'),/expectedBytes=12; actualBytes=3/);
});

test('native status diagnostics preserve decoder failure details before rejecting',async()=>{
 const snapshots=[];let listener;
 const api=compile('lib/hazard-tone-player.ts',require);
 const player={isLoaded:false,addListener:(_name,fn)=>{listener=fn;return{remove(){}};},play(){},muted:true,volume:0,loop:true};
 const pending=api.playHazardTone(player,{isCurrent:()=>true,registerCancel(){},report(){},reportStatus:s=>snapshots.push(s)});
 const rejected=assert.rejects(pending,/decoder probe/);
 listener({isLoaded:false,playing:false,playbackState:'failed',reasonForWaitingToPlay:'decoder probe',didJustFinish:false});
 await rejected;
 assert.equal(snapshots[0].reasonForWaitingToPlay,'decoder probe');
 assert.equal(snapshots[0].playbackState,'failed');
});
