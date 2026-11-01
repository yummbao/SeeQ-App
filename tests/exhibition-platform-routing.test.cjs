/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getRoutes } = require('expo-router/build/getRoutesCore');
const app = path.resolve(__dirname, '../app');
function keys(directory, prefix = './') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) return keys(path.join(directory,entry.name),prefix+entry.name+'/');
    return /\.[jt]sx?$/.test(entry.name) ? [prefix+entry.name] : [];
  });
}
for (const platform of ['web','ios','android']) test('Expo Router selects secure web routes only on '+platform,()=>{
  const context=()=>({default:function Screen(){}});
  context.keys=()=>keys(app);
  const routes=getRoutes(context,{platform,ignoreEntryPoints:true,importMode:'lazy'});
  const selected=[];
  const visit=node=>{if(node.contextKey)selected.push(node.contextKey);(node.children||[]).forEach(visit);};
  visit(routes);
  for(const name of ['index','index.final','index4']) {
    const expected=`./(tabs)/${name}${platform==='web'?'.web':''}.tsx`;
    assert.ok(selected.includes(expected),expected);
    assert.ok(!selected.includes(`./(tabs)/${name}${platform==='web'?'':'.web'}.tsx`));
  }
});
