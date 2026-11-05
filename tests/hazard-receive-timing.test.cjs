/* global __dirname */
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');
function load(name){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(require,module,module.exports);return module.exports;}
const {HazardReceiveClockAudit,formatHazardTiming}=load('hazard-receive-timing');
const {parseHazardSignal}=load('hazard-protocol');
const now=1793500000000;const raw=timestamp=>JSON.stringify({event:'LEVEL1',message:'기존 테스트 문구',timestamp,ttc:1.2});
test('Unix seconds are multiplied once; receive milliseconds and 150ms age are recorded exactly',()=>{
 const audit=new HazardReceiveClockAudit();const timing=audit.record(raw((now-150)/1000),now,0);
 assert.equal(timing.timestampRaw,(now-150)/1000);assert.equal(timing.validatorTimestampMs,now-150);assert.equal(timing.receivedAtMs,now);assert.equal(timing.ageMs,150);assert.equal(timing.ageSeconds,.15);assert.equal(timing.unitGuess,'unix-seconds');assert.ok(parseHazardSignal(raw((now-150)/1000),now));
});
test('2484-second stale report follows correct arithmetic, without accepting it',()=>{
 const timestamp=(now-2484000)/1000;const timing=new HazardReceiveClockAudit().record(raw(timestamp),now,0);
 assert.equal(timing.ageSeconds,2484);assert.equal(timing.ageMs,2484000);assert.equal(timing.unitGuess,'unix-seconds');assert.equal(parseHazardSignal(raw(timestamp),now),null);
 const text=formatHazardTiming(timing);assert.ok(text.includes(String(now)));assert.ok(text.includes(String(timestamp)));assert.match(text,/2484000 ms \/ 2484 초/);
});
test('millisecond timestamps are identified but never normalized into accepted alerts',()=>{
 const timing=new HazardReceiveClockAudit().record(raw(now),now,0);assert.equal(timing.unitGuess,'unix-milliseconds');assert.equal(timing.timestampRaw,now);assert.equal(timing.validatorTimestampMs,now*1000);assert.equal(parseHazardSignal(raw(now),now),null);
});
test('reused payload timestamp can be distinguished from a stream whose timestamp advances',()=>{
 const audit=new HazardReceiveClockAudit();const timestamp=(now-2484000)/1000;
 audit.record(raw(timestamp),now,100);const reused=audit.record(raw(timestamp),now+5000,5100);
 assert.equal(reused.timestampStepSeconds,0);assert.equal(reused.ageSeconds,2489);assert.equal(reused.unchangedTimestampForMs,5000);
 const advancing=audit.record(raw(timestamp+10),now+10000,10100);assert.equal(advancing.timestampStepSeconds,10);assert.equal(advancing.ageSeconds,2484);assert.equal(advancing.unchangedTimestampForMs,0);
});
test('phone wall-clock correction is recorded separately from monotonic receive interval',()=>{
 const audit=new HazardReceiveClockAudit();audit.record(raw(now/1000),now,0);const timing=audit.record(raw(now/1000),now+600500,500);
 assert.equal(timing.receiveStepMs,600500);assert.equal(timing.monotonicStepMs,500);assert.equal(timing.receiverClockStepMs,600000);assert.equal(timing.unchangedTimestampForMs,500);
 audit.reset();assert.equal(audit.record(raw(now/1000),now+601000,1000).previousTimestampRaw,null);
});
test('malformed/non-epoch/huge timestamps remain diagnostic only and do not crash',()=>{
 const audit=new HazardReceiveClockAudit();for(const value of ['bad','null','[]','x'.repeat(4097)])assert.equal(audit.record(value,now,0),null);
 assert.equal(audit.record(raw(1234),now,0).unitGuess,'unknown');assert.equal(parseHazardSignal(raw(1234),now),null);
 assert.equal(audit.record(raw(1e308),now,0).validatorTimestampMs,null);assert.equal(audit.record(raw('1234'),now,0).timestampType,'string');
});
test('freshness boundaries remain 10 seconds old and 30 seconds future',()=>{
 for(const [age,accepted]of[[10000,true],[10001,false],[-30000,true],[-30001,false]])assert.equal(parseHazardSignal(raw((now-age)/1000),now)!=null,accepted);
});
