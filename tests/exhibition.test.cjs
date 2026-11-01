/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require','module','exports', code)(name => {
    if (name in mocks) return mocks[name];
    if (name === './backend-policy') return load('lib/backend-policy.ts');
    return require(name);
  },module,module.exports);
  return module.exports;
}
const production = { projectId: 'production', authDomain:'production.firebaseapp.com', databaseURL:'https://production.firebaseio.com' };
const exhibition = { apiKey:'AIzaExample', projectId:'exhibition', authDomain:'exhibition.firebaseapp.com', appId:'example', databaseURL:'https://exhibition-default-rtdb.asia-southeast1.firebasedatabase.app' };
test('exhibition rejects missing config and every production identity, accepts a separate project', () => {
  const { exhibitionConfigError: error } = load('lib/backend-policy.ts');
  assert.ok(error({},production));
  assert.ok(error({...exhibition,apiKey:'YOUR_KEY'},production));
  for (const key of ['projectId','authDomain','databaseURL']) assert.ok(error({...exhibition,[key]:production[key]},production));
  assert.ok(error({...exhibition,databaseURL:'http://exhibition.firebaseio.com'},production));
  assert.equal(error(exhibition,production),'');
});
test('web initializes only an inert, isolated app when not configured; no production fallback', () => {
  const keys = Object.keys(process.env).filter(key => key.startsWith('EXPO_PUBLIC_EXHIBITION_FIREBASE_'));
  const previous = Object.fromEntries(keys.map(key => [key,process.env[key]]));
  keys.forEach(key => delete process.env[key]);
  const calls = [];
  try {
    const api = load('lib/backend.web.ts', {
      'firebase/app':{getApps:()=>[],initializeApp:(config,name)=>{calls.push({config,name});return{config,name};}},
      'firebase/auth':{getAuth:app=>({app})}, 'firebase/database':{getDatabase:app=>({app})},
    });
    const result = api.createSeeqBackend(production);
    assert.ok(result.backendError);
    assert.equal(calls.length,1);
    assert.notEqual(calls[0].config.databaseURL,production.databaseURL);
    assert.equal(calls[0].name,'seeq-exhibition-seeq-exhibition-unconfigured');
  } finally { Object.assign(process.env,previous); }
});
test('web audio requires a gesture unlock, plays severity pattern and supports cancellation', async () => {
  let started = 0; let stopped = 0; let resumed = 0;
  class Context {
    state='suspended'; currentTime=0; destination={};
    async resume(){resumed++;this.state='running';}
    createOscillator(){return{frequency:{value:0},connect(){},disconnect(){},start(){started++;},stop(){stopped++;}};}
    createGain(){return{gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  global.window = {AudioContext:Context};
  try {
    const audio = load('lib/web-hazard-audio.web.ts');
    await assert.rejects(audio.playWebHazardTone(true),/소리 활성화/);
    await audio.prepareHazardAudio();
    const pending = audio.playWebHazardTone(true);
    assert.equal(resumed,1);assert.equal(started,3);
    audio.cancelWebHazardTone(); await pending;
    assert.ok(stopped >= 3);
  } finally { delete global.window; }
});
test('browser without Web Audio fails explicitly, without native startup failure', async () => {
  global.window = {};
  try { await assert.rejects(load('lib/web-hazard-audio.web.ts').prepareHazardAudio(),/지원하지/); }
  finally { delete global.window; }
});
test('native backend still initializes original config unchanged', () => {
  let input;
  const api=load('lib/backend.native.ts',{
    'firebase/app':{getApps:()=>[],initializeApp:config=>{input=config;return config;}},
    'firebase/auth':{getAuth:app=>app},'firebase/database':{getDatabase:app=>app},
  });
  assert.equal(api.createSeeqBackend(production).backendError,'');
  assert.equal(input,production);
});

test('switching visitors waits for hydration and discards a late previous-account response', async () => {
  const source = ts.createSourceFile('index.tsx',fs.readFileSync(path.join(root,'app/(tabs)/index.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if(ts.isCallExpression(node) && node.expression.getText(source)==='onAuthStateChanged') callback=node.arguments[1].getText(source);
    ts.forEachChild(node,visit);
  }
  visit(source); assert.ok(callback);
  const state={}; const pending=new Map();
  const scope={
    Platform:{OS:'web'}, auth:{},db:{},storageNamespace:'exhibition:separate:',
    AsyncStorage:{getItem:async key=>JSON.stringify([key.split(':').at(-1)])},
    get:key=>new Promise(resolve=>pending.set(key,resolve)),ref:(_db,key)=>key,
    shownConnectionRequestIdsRef:{current:new Set()},console:{log(){}},
  };
  for(const field of ['CurrentUser','Favorites','RecentPlaces','GuardianTargets','SelectedGuardianTarget','PairedGuardianInfo','MovementHistory','MyPairCode','UserType','CurrentScreen']) scope['set'+field]=value=>{
    if(['Favorites','RecentPlaces','GuardianTargets','MovementHistory'].includes(field)) assert.equal(state.CurrentUser,null,'persistence must remain inactive during hydration');
    state[field]=value;
  };
  const mod={exports:{}};
  const code=ts.transpileModule('module.exports = ('+callback+');',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('module',...Object.keys(scope),'let authGeneration = 0;\n'+code)(mod,...Object.values(scope));
  const userA={uid:'A',emailVerified:true},userB={uid:'B',emailVerified:true};
  const first=mod.exports(userA);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.CurrentUser,null);
  const second=mod.exports(userB);
  await new Promise(resolve=>setImmediate(resolve));
  pending.get('profiles/B')({val:()=>({type:'guardian',pairCode:'BBBBBB'})});
  await second;
  assert.equal(state.CurrentUser,userB);assert.deepEqual(state.Favorites,['B']);
  pending.get('profiles/A')({val:()=>({type:'user',pairCode:'AAAAAA'})});
  await first;
  assert.equal(state.CurrentUser,userB);assert.deepEqual(state.Favorites,['B']);assert.equal(state.UserType,'guardian');
});
