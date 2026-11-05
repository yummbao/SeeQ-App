/* global __dirname */
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');
const root=path.resolve(__dirname,'..');const cache=new Map();
function load(file){if(cache.has(file))return cache.get(file);const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(root,'lib',file+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(name=>name.startsWith('./')?load(name.slice(2)):require(name),module,module.exports);cache.set(file,module.exports);return module.exports;}
const {diagnoseHazardFrame,formatHazardFrameIssue}=load('hazard-frame-diagnostics');
const {parseHazardSignal}=load('hazard-protocol');const {openHazardSocket}=load('hazard-socket-core');
const now=Date.now();const payload=(extra={})=>JSON.stringify({event:'LEVEL1',message:'기존 감지 멘트',ttc:1.2,timestamp:now/1000,...extra});
test('valid frames are unchanged and have no rejection diagnostic',()=>{for(const event of ['LEVEL1','LEVEL2','CROSSWALK','GO']){const raw=payload({event});assert.ok(parseHazardSignal(raw,now));assert.equal(diagnoseHazardFrame(raw,now),null);}});
test('malformed fields produce specific diagnostics instead of an ambiguous generic message',()=>{
 const cases=[['not json','invalid-json'],['null','not-object'],['[]','not-object'],['{}','missing-event'],[payload({event:'LEVEL3'}),'unsupported-event'],[payload({message:''}),'invalid-message'],[payload({timestamp:String(now/1000)}),'invalid-timestamp'],[payload({ttc:-1}),'invalid-ttc']];
 for(const[raw,code]of cases){assert.equal(parseHazardSignal(raw,now),null);assert.equal(diagnoseHazardFrame(raw,now).code,code);}
 assert.equal(diagnoseHazardFrame({},now).code,'not-text');assert.equal(diagnoseHazardFrame('x'.repeat(4097),now).code,'too-large');
});
test('timestamp units and clock skew are diagnosed without accepting stale or future warnings',()=>{
 const cases=[[now,'timestamp-milliseconds'],[(now-11000)/1000,'stale'],[(now+31000)/1000,'future']];
 for(const[timestamp,code]of cases){const raw=payload({timestamp});assert.equal(parseHazardSignal(raw,now),null);assert.equal(diagnoseHazardFrame(raw,now).code,code);}
 assert.match(diagnoseHazardFrame(payload({timestamp:(now-11000)/1000}),now).message,/11\.0초/);
 assert.equal(diagnoseHazardFrame(payload({timestamp:(now-10000)/1000}),now),null);
 assert.equal(diagnoseHazardFrame(payload({timestamp:(now+30000)/1000}),now),null);
 assert.doesNotThrow(()=>diagnoseHazardFrame(payload({timestamp:1e308}),now));
});
test('on-screen diagnostics include a bounded raw JSON sample',()=>{const raw=JSON.stringify({level:1,body:'x'.repeat(1500)});const issue=diagnoseHazardFrame(raw,now);const text=formatHazardFrameIssue(issue,raw);assert.match(text,/missing-event/);assert.match(text,/level/);assert.match(text,/수신 원문:/);assert.ok(text.length<1100);});
test('socket shows exact rejected data, does not trigger a hazard, then recovers on the next valid frame',()=>{
 const sockets=[],errors=[],signals=[];class Socket{constructor(){sockets.push(this);}close(){}}
 const timers=new Map();let counter=0;
 const close=openHazardSocket({endpoint:'ws://localhost:5000',onStatus(){},onError:message=>errors.push(message),onSignal:signal=>signals.push(signal),onDisconnect(){}},{WebSocket:Socket,setTimeout:fn=>{timers.set(++counter,fn);return counter;},clearTimeout:id=>timers.delete(id)});
 const socket=sockets[0];socket.onopen();const raw=JSON.stringify({level:1,time:Date.now()});socket.onmessage({data:raw});
 assert.match(errors.at(-1),/수신 진단: missing-event/);assert.ok(errors.at(-1).includes(raw));assert.equal(signals.length,0);
 socket.onmessage({data:payload({timestamp:Date.now()/1000})});assert.equal(signals.length,1);assert.equal(errors.at(-1),'');close();assert.equal(timers.size,0);
});
