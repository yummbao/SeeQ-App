/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname,'..');
function load(file, mocks) {
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>name in mocks?mocks[name]:require(name),module,module.exports);
  return module.exports;
}

test('guardian row renders sibling HTML buttons using real react-native-web and keeps actions separate',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://seeq.example',pretendToBeVisual:true});
  global.window=dom.window;global.document=dom.window.document;
  global.HTMLElement=dom.window.HTMLElement;global.Element=dom.window.Element;global.ShadowRoot=dom.window.ShadowRoot;global.Node=dom.window.Node;
  global.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  Object.defineProperty(global,'navigator',{configurable:true,value:dom.window.navigator});
  global.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
  global.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
  global.IS_REACT_ACT_ENVIRONMENT=true;
  const errors=[];const originalError=console.error;
  console.error=(...args)=>{errors.push(args.map(String).join(' '));};
  let mounted;
  try {
    const rn=require('react-native-web');
    const spoken=load('components/spoken-button.tsx',{'react-native':rn,'@/lib/app-speech':{describeButton(){},getSpeechRevision:()=>0}});
    const {GuardianTargetRow}=load('components/guardian-target-row.web.tsx',{'react-native':rn,'@/components/spoken-button':spoken,'@expo/vector-icons':{Ionicons:()=>React.createElement('span',{'aria-hidden':true})}});
    mounted=require('react-dom/client').createRoot(document.getElementById('root'));
    let opens=0;let disconnects=0;
    await React.act(async()=>mounted.render(React.createElement(GuardianTargetRow,{target:{name:'전시 사용자',userId:'visitor',status:'연결됨'},isLast:true,brandColor:'#D2FF00',onOpen:()=>{opens++;},onDisconnect:async()=>{await Promise.resolve();disconnects++;}})));
    const buttons=[...document.querySelectorAll('button')];
    assert.equal(buttons.length,2);
    assert.equal(document.querySelector('button button'),null);
    const open=buttons.find(button=>button.getAttribute('aria-label')==='전시 사용자 위치');
    const disconnect=buttons.find(button=>button.getAttribute('aria-label')==='전시 사용자 연결 해제');
    assert.ok(open);assert.ok(disconnect);assert.equal(open.parentElement,disconnect.parentElement);
    assert.ok(document.body.textContent.includes('아이디 visitor'));assert.ok(document.body.textContent.includes('연결됨'));
    await React.act(async()=>disconnect.click());
    assert.equal(disconnects,1);assert.equal(opens,0,'disconnect must not also navigate to the map');
    await React.act(async()=>{open.focus();open.click();});
    assert.equal(document.activeElement,open);assert.equal(opens,1);assert.equal(disconnects,1);
    assert.ok(!errors.some(message=>/nested|cannot contain|hydration|validateDOMNesting/i.test(message)),errors.join('\n'));
  } finally {
    if(mounted)await React.act(async()=>mounted.unmount());
    console.error=originalError;dom.window.close();delete global.window;delete global.document;
  }
});

test('web screens and shared connection UI contain no directly nested button controls',()=>{
  const files=['app/(tabs)/index.web.tsx','components/guardian-target-row.web.tsx','components/web-experience.web.tsx','components/hazard-connection-screen.tsx'];
  const buttonTags=new Set(['TouchableOpacity','SpokenButton','Pressable','PlatformPressable','Button','button']);
  for(const file of files){
    const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    function visit(node,ancestors=[]){
      const tag=ts.isJsxElement(node)?node.openingElement.tagName.getText(source):ts.isJsxSelfClosingElement(node)?node.tagName.getText(source):'';
      const isButton=buttonTags.has(tag);
      if(isButton)assert.equal(ancestors.length,0,`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line+1} nests a button inside ${ancestors.join(',')}`);
      ts.forEachChild(node,child=>visit(child,isButton?[...ancestors,tag]:ancestors));
    }
    visit(source);
  }
});
