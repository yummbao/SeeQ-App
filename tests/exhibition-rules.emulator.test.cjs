/* global __dirname */
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..');
const toolRequire=createRequire(path.join(root,'tools/security-tests/package.json'));
const {initializeTestEnvironment,assertFails,assertSucceeds}=toolRequire('@firebase/rules-unit-testing');
const sdk=toolRequire('firebase/database');
const ts=require('typescript');
if(!/^(127\.0\.0\.1|localhost):9000$/.test(process.env.FIREBASE_DATABASE_EMULATOR_HOST||''))throw Error('Run with the local Database Emulator on port 9000. Cloud tests are prohibited.');
const moduleUnderTest={exports:{}};
new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,'lib/exhibition-data.web.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(()=>sdk,moduleUnderTest,moduleUnderTest.exports);
const app=moduleUnderTest.exports;
let env;let dbA,dbB,dbG,dbH,anonymous;
const dbFor=(uid,verified=true)=>env.authenticatedContext(uid,{email:uid+'@example.test',email_verified:verified}).database();
const r=(db,p)=>sdk.ref(db,p || undefined);
const value=async(db,p)=>(await sdk.get(r(db,p))).val();
const deniedRead=(db,p)=>assertFails(sdk.get(r(db,p)));
const deniedWrite=(db,p,v)=>assertFails(sdk.set(r(db,p),v));
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-seeq-exhibition-security',database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync(path.join(root,'database.exhibition.rules.json'),'utf8')}});});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
 await env.clearDatabase();
 dbA=dbFor('A');dbB=dbFor('B');dbG=dbFor('G');dbH=dbFor('H');anonymous=env.unauthenticatedContext().database();
 for(const [uid,type,db] of [['A','user',dbA],['B','user',dbB],['G','guardian',dbG],['H','guardian',dbH]]){
  await app.createExhibitionProfile(db,{uid,email:uid+'@example.test'},{name:uid+' name',userId:uid+'-id',type,createdAt:new Date().toISOString()});
 }
});
async function request(db=dbG,g='G',targetDb=dbA,target='A'){
 const code=await app.rotateExhibitionPairCode(targetDb,target);
 await app.sendExhibitionRequest(db,g,code);
 return {code,request:await value(targetDb,`pendingRequests/${target}/${g}`)};
}
async function connected(){const result=await request();await app.respondExhibitionRequest(dbA,'A','G',true,result.request.requestId);return result;}
const iso=()=>new Date().toISOString();
test('unverified signup can create its own minimal profile, but cannot use pairing or read others',async()=>{
 const unverified=dbFor('N',false);
 await assertSucceeds(app.createExhibitionProfile(unverified,{uid:'N',email:'N@example.test'},{name:'N',userId:'N-id',type:'user',createdAt:iso()}));
 await deniedRead(unverified,'profiles/A');await assert.rejects(app.rotateExhibitionPairCode(unverified,'N'));
});
test('anonymous access and directory enumeration are denied',async()=>{
 for(const p of ['profiles','profiles/A','users','users/A','pairCodes','pendingRequests','connectionRequests','guardianLinks'])await deniedRead(anonymous,p);
 await deniedWrite(anonymous,'profiles/A/name','intruder');
 for(const p of ['profiles','users','pairCodes','usersByEmail','usersById'])await deniedRead(dbG,p);
});
test('other visitors cannot read email, private profile, code, or location; legacy indexes are closed',async()=>{
 const code=await app.rotateExhibitionPairCode(dbA,'A');
 for(const db of [dbB,dbG,dbH])for(const p of ['profiles/A','profiles/A/email','profiles/A/pairCode','users/A','users/A/email','users/A/location'])await deniedRead(db,p);
 await deniedRead(dbB,'pairCodes/'+code);
 for(const p of ['usersByEmail/A_example_test','usersById/A-id']){await deniedRead(dbA,p);await deniedWrite(dbA,p,{uid:'A',email:'A@example.test'});}
});
test('delivered high entropy code only grants verified guardian UID/expiry lookup; unknown and expired codes fail',async()=>{
 const code=await app.rotateExhibitionPairCode(dbA,'A');assert.match(code,/^[A-F0-9]{32}$/);
 const info=await value(dbG,'pairCodes/'+code);assert.equal(info.uid,'A');assert.deepEqual(Object.keys(info).sort(),['expiresAt','uid']);
 await deniedRead(dbG,'pairCodes/'+'F'.repeat(32));
 await env.withSecurityRulesDisabled(async c=>{await sdk.set(r(c.database(),`pairCodes/${code}/expiresAt`),Date.now()-1);});
 await deniedRead(dbG,'pairCodes/'+code);await deniedRead(dbFor('X',false),'pairCodes/'+code);
});
test('code rotation is atomic, revokes old capability and existing pending consent',async()=>{
 const {code,request:pending}=await request();const next=await app.rotateExhibitionPairCode(dbA,'A');
 assert.notEqual(next,code);await deniedRead(dbG,'pairCodes/'+code);
 await assert.rejects(app.respondExhibitionRequest(dbA,'A','G',true,pending.requestId));
 await deniedWrite(dbA,'profiles/A/pairCode','A'.repeat(32));
 await deniedWrite(dbB,'pairCodes/'+next,{uid:'B',expiresAt:Date.now()+1000});
});
test('owner parent writes, deletion, role changes and unknown fields cannot bypass paired-field rules',async()=>{
 const profile=await value(dbA,'profiles/A');
 await deniedWrite(dbA,'profiles/A',{...profile,pairedGuardian:'G'});
 await deniedWrite(dbA,'users/A',{...(await value(dbA,'users/A')),pairedGuardian:'G'});
 for(const p of ['profiles/A/pairedGuardian','users/A/pairedGuardian'])await deniedWrite(dbA,p,'G');
 for(const p of ['profiles/G/pairedUser','users/G/pairedUser'])await deniedWrite(dbG,p,'A');
 await deniedWrite(dbA,'profiles/A/type','guardian');await deniedWrite(dbA,'users/A/type','guardian');
 await deniedWrite(dbA,'profiles/A',null);await deniedWrite(dbA,'profiles/A/unknown','value');
 await assertSucceeds(sdk.set(r(dbA,'profiles/A/name'),'Renamed'));
});
test('request creation requires guardian role, valid capability and identical atomic mirrors',async()=>{
 const code=await app.rotateExhibitionPairCode(dbA,'A');
 await assert.rejects(app.sendExhibitionRequest(dbB,'B',code));
 await deniedWrite(dbG,'pendingRequests/A/G',{guardianUid:'G',status:'pending'});
 await app.sendExhibitionRequest(dbG,'G',code);
 const req=await value(dbA,'pendingRequests/A/G');assert.equal(req.status,'pending');
 assert.deepEqual(req,await value(dbG,'connectionRequests/A/G'));assert.deepEqual(req,await value(dbG,'guardianSentRequests/G/A'));
 await deniedRead(dbH,'pendingRequests/A/G');await deniedRead(dbH,'connectionRequests/A/G');await deniedRead(dbH,'guardianSentRequests/G');
 await deniedWrite(dbG,'connectionRequests/A/G/guardianName','forged');
});
test('only the target user can accept, and all pair/link/audit fields must change atomically',async()=>{
 const {request:pending}=await request();
 await assert.rejects(app.respondExhibitionRequest(dbG,'A','G',true,pending.requestId));
 await assert.rejects(app.respondExhibitionRequest(dbB,'A','G',true,pending.requestId));
 await deniedWrite(dbA,'profiles/A/pairedGuardian','G');
 await deniedWrite(dbA,'connectionRequests/A/G/status','approved');
 await assertFails(sdk.update(r(dbA,''),{'profiles/A/pairedGuardian':'G','users/A/pairedGuardian':'G','profiles/G/pairedUser':'A','users/G/pairedUser':'A'}));
 await assertSucceeds(app.respondExhibitionRequest(dbA,'A','G',true,pending.requestId));
 assert.equal(await value(dbA,'profiles/A/pairedGuardian'),'G');assert.equal(await value(dbG,'profiles/G/pairedUser'),'A');
 assert.equal(await value(dbA,'users/A/pairedGuardian'),'G');assert.equal(await value(dbG,'users/G/pairedUser'),'A');
 assert.equal((await value(dbG,'guardianLinks/G/A')).requestId,pending.requestId);
 assert.equal(await value(dbA,'pendingRequests/A/G'),null);
 assert.equal((await value(dbG,'connectionRequests/A/G')).status,'approved');
 await assert.rejects(app.respondExhibitionRequest(dbA,'A','G',true,pending.requestId));
});
test('linked users see only name/id; email/code/profile roots stay private',async()=>{
 await connected();
 assert.deepEqual(await app.readLinkedSummary(dbG,'A'),{name:'A name',userId:'A-id'});
 assert.deepEqual(await app.readLinkedSummary(dbA,'G'),{name:'G name',userId:'G-id'});
 for(const p of ['profiles/A','profiles/A/email','profiles/A/pairCode','users/A'])await deniedRead(dbG,p);
 await deniedRead(dbB,'profiles/A/name');await deniedRead(dbH,'profiles/A/name');
});
test('location and history require approval AND sharing or SOS; guardians cannot write them',async()=>{
 await sdk.set(r(dbA,'users/A/location'),{latitude:37.5,longitude:127,timestamp:iso()});
 await sdk.set(r(dbA,'users/A/moveHistory'),[{latitude:37.5,longitude:127,timestamp:iso()}]);
 await sdk.set(r(dbA,'users/A/shareLocation'),true);await deniedRead(dbG,'users/A/location');
 await connected();assert.equal((await value(dbG,'users/A/location')).latitude,37.5);
 await deniedRead(dbH,'users/A/location');await deniedWrite(dbG,'users/A/shareLocation',true);
 await deniedWrite(dbG,'users/A/location',{latitude:0,longitude:0,timestamp:iso()});
 await sdk.set(r(dbA,'users/A/shareLocation'),false);await deniedRead(dbG,'users/A/location');await deniedRead(dbG,'users/A/moveHistory');
 await sdk.set(r(dbA,'users/A/status'),{emergency:true,timestamp:iso()});
 await assertSucceeds(sdk.get(r(dbG,'users/A/location')));await assertSucceeds(sdk.get(r(dbG,'users/A/moveHistory')));
 await sdk.set(r(dbA,'users/A/status'),{emergency:false,timestamp:iso()});await deniedRead(dbG,'users/A/location');
 await deniedWrite(dbA,'users/A/location',{latitude:1000,longitude:127,timestamp:iso()});
});
test('rejection consumes pending request and never creates a connection',async()=>{
 const {request:pending}=await request();await app.respondExhibitionRequest(dbA,'A','G',false,pending.requestId);
 assert.equal(await value(dbA,'pendingRequests/A/G'),null);assert.equal((await value(dbG,'connectionRequests/A/G')).status,'rejected');
 assert.equal(await value(dbG,'guardianLinks/G/A'),null);assert.equal(await value(dbA,'profiles/A/pairedGuardian'),null);
 await assert.rejects(app.respondExhibitionRequest(dbA,'A','G',true,pending.requestId));
});
test('guardian can atomically cancel pending request but cannot delete another guardian request',async()=>{
 await request();const deletion={'pendingRequests/A/G':null,'connectionRequests/A/G':null,'guardianSentRequests/G/A':null};
 await assertFails(sdk.update(r(dbH,''),deletion));await deniedWrite(dbG,'pendingRequests/A/G',null);
 await assertSucceeds(sdk.update(r(dbG,''),deletion));assert.equal(await value(dbA,'pendingRequests/A/G'),null);
});
test('expired requests cannot be accepted and stale UI request ID cannot accept a newer request',async()=>{
 const {request:pending}=await request();
 await assert.rejects(app.respondExhibitionRequest(dbA,'A','G',true,'F'.repeat(32)));
 await env.withSecurityRulesDisabled(async c=>{await sdk.update(r(c.database(),''),{'pendingRequests/A/G/expiresAt':Date.now()-1,'connectionRequests/A/G/expiresAt':Date.now()-1,'guardianSentRequests/G/A/expiresAt':Date.now()-1});});
 await assert.rejects(app.respondExhibitionRequest(dbA,'A','G',true,pending.requestId));
 await deniedWrite(dbA,'profiles/A/pairedGuardian','G');
});
test('one user cannot accept two guardians; losing request can still be rejected',async()=>{
 const {request:first}=await request();const code=await value(dbA,'profiles/A/pairCode');await app.sendExhibitionRequest(dbH,'H',code);
 const second=await value(dbA,'pendingRequests/A/H');
 await app.respondExhibitionRequest(dbA,'A','G',true,first.requestId);
 await assert.rejects(app.respondExhibitionRequest(dbA,'A','H',true,second.requestId));
 await app.respondExhibitionRequest(dbA,'A','H',false,second.requestId);
 assert.equal(await value(dbA,'profiles/A/pairedGuardian'),'G');
});
test('guardianLinks cannot be forged or deleted alone; outsider cannot disconnect',async()=>{
 await deniedWrite(dbG,'guardianLinks/G/A',{uid:'A',name:'A name',userId:'A-id',requestId:'F'.repeat(32),approvedAt:Date.now()});
 await connected();await deniedWrite(dbG,'guardianLinks/G/A',null);await deniedWrite(dbA,'profiles/A/pairedGuardian',null);
 await assert.rejects(app.disconnectExhibitionPair(dbB,'A','G'));await deniedWrite(dbH,'users/A/pairedGuardian',null);
});
for(const side of ['user','guardian'])test(side+' can atomically disconnect; data access and replay approval are revoked',async()=>{
 const {request:pending}=await connected();await sdk.set(r(dbA,'users/A/shareLocation'),true);
 await app.disconnectExhibitionPair(side==='user'?dbA:dbG,'A','G');
 assert.equal(await value(dbA,'profiles/A/pairedGuardian'),null);assert.equal(await value(dbG,'profiles/G/pairedUser'),null);
 assert.equal(await value(dbG,'guardianLinks/G/A'),null);assert.equal((await value(dbG,'connectionRequests/A/G')).status,'disconnected');
 await deniedRead(dbG,'users/A/location');await deniedRead(dbG,'profiles/A/name');await deniedWrite(dbA,'profiles/A/pairedGuardian','G');
 await assert.rejects(app.respondExhibitionRequest(dbA,'A','G',true,pending.requestId));
});

test('one guardian cannot acquire two users from concurrent pending requests',async()=>{
 const {request:first}=await request();const codeB=await app.rotateExhibitionPairCode(dbB,'B');
 await app.sendExhibitionRequest(dbG,'G',codeB);const second=await value(dbB,'pendingRequests/B/G');
 await app.respondExhibitionRequest(dbA,'A','G',true,first.requestId);
 await assert.rejects(app.respondExhibitionRequest(dbB,'B','G',true,second.requestId));
 assert.equal(await value(dbG,'profiles/G/pairedUser'),'A');
 await app.respondExhibitionRequest(dbB,'B','G',false,second.requestId);
});
test('pending status and immutable request proof cannot be edited in isolation',async()=>{
 const {request:pending}=await request();
 await deniedWrite(dbA,'pendingRequests/A/G/status','approved');
 await deniedWrite(dbG,'pendingRequests/A/G/status','approved');
 await deniedWrite(dbG,'connectionRequests/A/G/pairCode','F'.repeat(32));
 const mismatched={...pending,requestId:'F'.repeat(32),requestedAt:sdk.serverTimestamp()};
 await assertFails(sdk.update(r(dbH,''),{'pendingRequests/A/G':mismatched,'connectionRequests/A/G':mismatched,'guardianSentRequests/G/A':mismatched}));
 await app.respondExhibitionRequest(dbA,'A','G',true,pending.requestId);
 await deniedWrite(dbG,'connectionRequests/A/G',null);await deniedWrite(dbA,'guardianSentRequests/G/A',null);
});
test('an expired request can be replaced but a stale approval callback cannot accept the replacement',async()=>{
 const {code,request:old}=await request();
 await env.withSecurityRulesDisabled(async c=>{await sdk.update(r(c.database(),''),{'pendingRequests/A/G/expiresAt':Date.now()-1,'connectionRequests/A/G/expiresAt':Date.now()-1,'guardianSentRequests/G/A/expiresAt':Date.now()-1});});
 await app.sendExhibitionRequest(dbG,'G',code);const fresh=await value(dbA,'pendingRequests/A/G');assert.notEqual(fresh.requestId,old.requestId);
 await assert.rejects(app.respondExhibitionRequest(dbA,'A','G',true,old.requestId));
 await app.respondExhibitionRequest(dbA,'A','G',true,fresh.requestId);
});
