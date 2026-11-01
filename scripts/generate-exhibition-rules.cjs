/* global __dirname */
const fs=require('node:fs');
const output=process.argv[2] || require('node:path').resolve(__dirname,'../database.exhibition.rules.json');
const q=x=>JSON.stringify(x);
const child=(base,...parts)=>parts.reduce((s,p)=>`${s}.child(${p})`,base);
const at=(base,path)=>child(base,q(path));
const field=(base,table,u,key)=>child(base,q(table),u,q(key));
const auth="auth != null";
const verified=`(${auth} && auth.token.email_verified == true)`;
const role=(u,type)=>`${field('root','profiles',u,'type')}.val() == '${type}'`;
const req=(base,u,g)=>child(base,q('connectionRequests'),u,g);
const pending=(base,u,g)=>child(base,q('pendingRequests'),u,g);
const sent=(base,u,g)=>child(base,q('guardianSentRequests'),g,u);
const link=(base,u,g)=>child(base,q('guardianLinks'),g,u);
const eq=(snapshot,key,value)=>`${at(snapshot,key)}.val() == ${value}`;
const all=(...s)=>`(${s.join(' && ')})`;
const either=(...s)=>`(${s.join(' || ')})`;
const mirrors=(r,u,g)=>all(
  `${field(r,'profiles',u,'pairedGuardian')}.val() == ${g}`,`${field(r,'users',u,'pairedGuardian')}.val() == ${g}`,
  `${field(r,'profiles',g,'pairedUser')}.val() == ${u}`,`${field(r,'users',g,'pairedUser')}.val() == ${u}`);
const cleared=(r,u,g)=>all(...[['profiles',u,'pairedGuardian'],['users',u,'pairedGuardian'],['profiles',g,'pairedUser'],['users',g,'pairedUser']].map(([t,id,f])=>`!${field(r,t,id,f)}.exists()`),`!${link(r,u,g)}.exists()`);
const secureLinked=(u,g)=>all(mirrors('root',u,g),eq(req('root',u,g),'status',"'approved'"),`${at(req('root',u,g),'requestId')}.isString()`,eq(link('root',u,g),'requestId',`${at(req('root',u,g),'requestId')}.val()`));
const noPartners=(u,g)=>all(`!${field('root','profiles',u,'pairedGuardian')}.exists()`,`!${field('root','users',u,'pairedGuardian')}.exists()`,`!${field('root','profiles',g,'pairedUser')}.exists()`,`!${field('root','users',g,'pairedUser')}.exists()`);
const capability=(u,code)=>all(`${field('root','profiles',u,'pairCode')}.val() == ${code}`,`${child('root',q('pairCodes'),code,q('uid'))}.val() == ${u}`,`${child('root',q('pairCodes'),code,q('expiresAt'))}.val() > now`);
const pendingProof=(u,g)=>all(eq(pending('root',u,g),'status',"'pending'"),`${at(pending('root',u,g),'expiresAt')}.val() > now`,eq(req('root',u,g),'status',"'pending'"),eq(pending('root',u,g),'requestId',`${at(req('root',u,g),'requestId')}.val()`),capability(u,`${at(pending('root',u,g),'pairCode')}.val()`));
const auditMirrors=(r,u,g,status,id)=>all(eq(req(r,u,g),'status',q(status)),eq(sent(r,u,g),'status',q(status)),eq(req(r,u,g),'requestId',id),eq(sent(r,u,g),'requestId',id));
const approval=(r,u,g)=>all(verified,`auth.uid == ${u}`,role(u,'user'),role(g,'guardian'),pendingProof(u,g),noPartners(u,g),mirrors(r,u,g),`!${pending(r,u,g)}.exists()`,auditMirrors(r,u,g,'approved',`${at(pending('root',u,g),'requestId')}.val()`),eq(link(r,u,g),'requestId',`${at(pending('root',u,g),'requestId')}.val()`));
const disconnect=(r,u,g)=>all(verified,either(`auth.uid == ${u}`,`auth.uid == ${g}`),secureLinked(u,g),cleared(r,u,g),`!${pending(r,u,g)}.exists()`,auditMirrors(r,u,g,'disconnected',`${at(req('root',u,g),'requestId')}.val()`));
const paired=(kind)=>{
 const isGuardian=kind==='pairedGuardian';const u=isGuardian?'$uid':'newData.val()';const g=isGuardian?'newData.val()':'$uid';
 const oldU=isGuardian?'$uid':'data.val()';const oldG=isGuardian?'data.val()':'$uid';
 const final='newData.parent().parent().parent()';
 return {'.write':either(all(auth,'auth.uid == $uid','!data.exists()','!newData.exists()'),all('newData.isString()','!data.exists()',approval(final,u,g)),all('data.isString()','!newData.exists()',disconnect(final,oldU,oldG))),'.validate':'newData.isString() && newData.val().length <= 128'};
};
const owner=`${auth} && auth.uid == $uid`;
const ownerVerified=`${verified} && auth.uid == $uid`;
const otherLinked=either(secureLinked('$uid','auth.uid'),secureLinked('auth.uid','$uid'));
const bounded=(n)=>`newData.isString() && newData.val().length > 0 && newData.val().length <= ${n}`;
const ownField=(validate,immutable=false)=>({'.write':`${owner} && newData.exists()${immutable?' && !data.exists()':''}`,'.validate':validate});
const metadata={uid:ownField('newData.val() == $uid',true),name:ownField(bounded(80)),userId:ownField(bounded(80)),email:ownField('newData.isString() && newData.val() == auth.token.email.toLowerCase()',true)};
const profiles={'.read':owner,'.validate':"newData.hasChildren(['uid','name','userId','email','type','createdAt','verifiedAt'])",...metadata,
 type:ownField("newData.val() == 'user' || newData.val() == 'guardian'",true),
 createdAt:ownField(bounded(40),true),verifiedAt:ownField(bounded(40),true),
 pairedGuardian:paired('pairedGuardian'),pairedUser:paired('pairedUser'),
 pairCode:{'.write':all(ownerVerified,role('$uid','user'),either(all('newData.isString()',"newData.val().matches(/^[A-F0-9]{32}$/)",`${child('newData.parent().parent().parent()',q('pairCodes'),'newData.val()',q('uid'))}.val() == $uid`,either('!data.exists()','data.val() == newData.val()',`!${child('newData.parent().parent().parent()',q('pairCodes'),'data.val()')}.exists()`)),all('!newData.exists()',`!${child('newData.parent().parent().parent()',q('pairCodes'),'data.val()')}.exists()`)))},
 '$other':{'.validate':false},
};
for(const f of ['name','userId']) profiles[f]['.read']=`${verified} && ${otherLinked}`;
const guardianRead=all(verified,secureLinked('$uid','auth.uid'));
const shared=all(guardianRead,either(`${field('root','users','$uid','shareLocation')}.val() == true`,`${field('root','users','$uid','status/emergency')}.val() == true`));
const users={'.read':owner,'.validate':"newData.hasChildren(['uid','name','userId','email','type','shareLocation','emergency'])",...metadata,
 type:ownField(`${field('newData.parent().parent().parent()','profiles','$uid','type')}.val() == newData.val()`,true),
 pairedGuardian:paired('pairedGuardian'),pairedUser:paired('pairedUser'),
 shareLocation:{'.read':guardianRead,'.write':all(ownerVerified,role('$uid','user'),'newData.isBoolean()')},
 emergency:{'.write':`${owner} && newData.isBoolean()`,'.validate':'newData.isBoolean()'},
 status:{'.read':guardianRead,'.write':all(ownerVerified,role('$uid','user'),'newData.exists()'),'.validate':"newData.hasChildren(['emergency','timestamp'])",emergency:{'.validate':'newData.isBoolean()'},timestamp:{'.validate':bounded(40)},'$other':{'.validate':false}},
 location:{'.read':shared,'.write':all(ownerVerified,role('$uid','user')),'.validate':"newData.hasChildren(['latitude','longitude','timestamp'])",latitude:{'.validate':'newData.isNumber() && newData.val() >= -90 && newData.val() <= 90'},longitude:{'.validate':'newData.isNumber() && newData.val() >= -180 && newData.val() <= 180'},timestamp:{'.validate':bounded(40)},'$other':{'.validate':false}},
 moveHistory:{'.read':shared,'.write':all(ownerVerified,role('$uid','user'))},
 '$other':{'.validate':false},
};
// Sharing starts false during unverified registration; later changes require verification.
users.shareLocation['.write']=either(users.shareLocation['.write'],all(owner,'!data.exists()','newData.val() == false'));
const requestValidation={'.validate':"newData.hasChildren(['targetUid','guardianUid','guardianName','pairCode','requestId','requestedAt','expiresAt','status'])",
 targetUid:{'.validate':'newData.val() == $targetUid'},guardianUid:{'.validate':'newData.val() == $guardianUid'},guardianName:{'.validate':bounded(80)},
 pairCode:{'.validate':"newData.isString() && newData.val().matches(/^[A-F0-9]{32}$/)"},requestId:{'.validate':"newData.isString() && newData.val().matches(/^[A-F0-9]{32}$/)"},
 requestedAt:{'.validate':'newData.isNumber()'},expiresAt:{'.validate':'newData.isNumber()'},status:{'.validate':"newData.val() == 'pending' || newData.val() == 'approved' || newData.val() == 'rejected' || newData.val() == 'disconnected'"},
 respondedAt:{'.validate':'newData.isNumber() && newData.val() == now'},disconnectedAt:{'.validate':'newData.isNumber() && newData.val() == now'},'$other':{'.validate':false}};
// Existing response timestamps remain unchanged when disconnecting.
requestValidation.respondedAt['.validate']='newData.isNumber() && (newData.val() == now || newData.val() == data.val())';
const u='$targetUid',g='$guardianUid';
const participant=all(verified,either(`auth.uid == ${u}`,`auth.uid == ${g}`));
const immutable=['targetUid','guardianUid','guardianName','pairCode','requestId','requestedAt','expiresAt'].map(k=>eq('newData',k,`${at('data',k)}.val()`));
const creation=(r)=>all(verified,`auth.uid == ${g}`,role(g,'guardian'),role(u,'user'),u+' != '+g,
 eq('newData','status',"'pending'"),either('!data.exists()',all("data.child('status').val() != 'approved'","data.child('status').val() != 'pending'"),"data.child('expiresAt').val() <= now"),
 "newData.child('requestId').val() != data.child('requestId').val()",noPartners(u,g),
 capability(u,"newData.child('pairCode').val()"),eq('newData','guardianName',`${field('root','profiles',g,'name')}.val()`),
 "newData.child('requestedAt').val() == now","newData.child('expiresAt').val() > now","newData.child('expiresAt').val() <= now + 300000",
 ...[req(r,u,g),pending(r,u,g),sent(r,u,g)].flatMap(s=>[eq(s,'requestId',"newData.child('requestId').val()"),eq(s,'status',"'pending'"),...['targetUid','guardianUid','guardianName','pairCode','requestedAt','expiresAt'].map(k=>eq(s,k,`${at('newData',k)}.val()`))]));
const cancel=(r)=>all(participant,"data.child('status').val() == 'pending'",`!${pending(r,u,g)}.exists()`,`!${req(r,u,g)}.exists()`,`!${sent(r,u,g)}.exists()`);
const terminalDelete=(r)=>all(participant,either("data.child('status').val() == 'rejected'","data.child('status').val() == 'disconnected'"),`!${pending(r,u,g)}.exists()`,`!${req(r,u,g)}.exists()`,`!${sent(r,u,g)}.exists()`);
const response=(r)=>all(participant,...immutable,either(
 all("data.child('status').val() == 'pending'","newData.child('status').val() == 'approved'",approval(r,u,g)),
 all(`auth.uid == ${u}`,"data.child('status').val() == 'pending'","newData.child('status').val() == 'rejected'",`!${pending(r,u,g)}.exists()`,auditMirrors(r,u,g,'rejected',"data.child('requestId').val()")),
 all("data.child('status').val() == 'approved'","newData.child('status').val() == 'disconnected'",disconnect(r,u,g))));
const requestNode=(isPending=false)=>{
 const r='newData.parent().parent().parent()';
 return {'.read':participant,'.write':isPending?either(all('newData.exists()',creation(r)),all('!newData.exists()',either(cancel(r),terminalDelete(r),all(`auth.uid == ${u}`,"data.child('status').val() == 'pending'",either(approval(r,u,g),all(auditMirrors(r,u,g,'rejected',"data.child('requestId').val()"),eq(req('root',u,g),'status',"'pending'"))))))):either(all('newData.exists()',either(creation(r),response(r))),all('!newData.exists()',either(cancel(r),terminalDelete(r)))),...requestValidation};
};
// Atomic disconnect may include deleting an already-consumed pending row.
// This grants only a no-op to the two row participants, never creation/editing.
const allowNoopDelete = node => { node['.write'] = either(node['.write'], all(participant,'!data.exists()','!newData.exists()')); return node; };
const rules={'.read':false,'.write':false,
 profiles:{'$uid':profiles},users:{'$uid':users},
 pendingRequests:{'$targetUid':{'.read':all(verified,'auth.uid == $targetUid'),'$guardianUid':allowNoopDelete(requestNode(true))}},
 connectionRequests:{'$targetUid':{'.read':all(verified,'auth.uid == $targetUid'),'$guardianUid':requestNode()}},
 guardianSentRequests:{'$guardianUid':{'.read':all(verified,'auth.uid == $guardianUid'),'$targetUid':requestNode()}},
 guardianLinks:{'$guardianUid':{'.read':all(verified,'auth.uid == $guardianUid'),'$targetUid':{
  '.read':participant,'.write':either(all('!data.exists()','newData.exists()',approval('newData.parent().parent().parent()',u,g)),all('data.exists()','!newData.exists()',disconnect('newData.parent().parent().parent()',u,g))),
  '.validate':"newData.hasChildren(['uid','name','userId','requestId','approvedAt'])",uid:{'.validate':'newData.val() == $targetUid'},
  name:{'.validate':`newData.val() == ${field('root','profiles',u,'name')}.val()`},userId:{'.validate':`newData.val() == ${field('root','profiles',u,'userId')}.val()`},
  requestId:{'.validate':`newData.val() == ${at(pending('root',u,g),'requestId')}.val()`},approvedAt:{'.validate':'newData.isNumber() && newData.val() == now'},'$other':{'.validate':false},
 }}},
 pairCodes:{'$code':{
  '.read':all(verified,either("data.child('uid').val() == auth.uid",all(role('auth.uid','guardian'),"$code.matches(/^[A-F0-9]{32}$/)","data.child('expiresAt').val() > now",`${field('root','profiles',"data.child('uid').val()",'pairCode')}.val() == $code`))),
  '.write':all(verified,role('auth.uid','user'),either(
   all('newData.exists()',"$code.matches(/^[A-F0-9]{32}$/)","newData.child('uid').val() == auth.uid",either('!data.exists()',"data.child('uid').val() == auth.uid"),`${field('newData.parent().parent()','profiles','auth.uid','pairCode')}.val() == $code`),
   all('!newData.exists()',either("data.child('uid').val() == auth.uid",'data.val() == auth.uid'),`${field('newData.parent().parent()','profiles','auth.uid','pairCode')}.val() != $code`))),
  '.validate':"newData.hasChildren(['uid','expiresAt'])",uid:{'.validate':'newData.isString() && newData.val() == auth.uid'},expiresAt:{'.validate':'newData.isNumber() && newData.val() > now && newData.val() <= now + 900000'},'$other':{'.validate':false},
 }},
 usersByEmail:{'.read':false,'.write':false},usersById:{'.read':false,'.write':false},
};
fs.writeFileSync(output,JSON.stringify({rules},null,2)+'\n');
console.log('Generated exhibition rules only: '+output);
