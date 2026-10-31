const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function fixture() {
  const calls = [], cache = {};
  const expo = {
    stop: () => { calls.push(['stop']); return Promise.resolve(); },
    speak: (message, options) => calls.push(['speak', message, options]),
  };
  function load(name) {
    if (cache[name]) return cache[name];
    const source = fs.readFileSync(path.join(__dirname, '../lib', name + '.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(
      dependency => dependency === 'expo-speech' ? expo : load(dependency.replace('./', '')),
      module, module.exports,
    );
    return cache[name] = module.exports;
  }
  return { ...load('app-speech'), ...load('speech-priority'), calls };
}

test('rapid taps read only the last button instead of queuing every description', async () => {
  const f = fixture();
  f.describeButton('first'); f.describeButton('second');
  await Promise.resolve();
  assert.deepEqual(f.calls.filter(call => call[0] === 'speak').map(call => call[1]), ['second']);
});

test('a result message cancels a pending generic button description', async () => {
  const f = fixture();
  f.describeButton('login requested');
  f.AppSpeech.speak('email is required');
  await Promise.resolve();
  assert.deepEqual(f.calls.filter(call => call[0] === 'speak').map(call => call[1]), ['email is required']);
});

test('button speech cannot interrupt or speak over a hazard', async () => {
  const f = fixture();
  f.setHazardAudioActive(true);
  f.describeButton('button'); f.AppSpeech.stop(); f.AppSpeech.speak('guidance');
  await Promise.resolve();
  assert.equal(f.calls.length, 0);
});

test('a hazard arriving during speech preparation prevents the pending description', async () => {
  const f = fixture();
  f.describeButton('button');
  f.setHazardAudioActive(true);
  await Promise.resolve();
  assert.equal(f.calls.filter(call => call[0] === 'speak').length, 0);
});

test('stopping previous speech does not count as an existing spoken result', () => {
  const f = fixture();
  const before = f.getSpeechRevision();
  f.AppSpeech.stop();
  assert.equal(f.getSpeechRevision(), before);
  f.AppSpeech.speak('result');
  assert.notEqual(f.getSpeechRevision(), before);
  assert.equal(f.calls.at(-1)[2].language, 'ko-KR');
});
