/* global __dirname */
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
// Intentionally no --project parameter or .env loading: this runner can use only a demo emulator.
const env = {};
for (const name of ['PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','HOME','HTTPS_PROXY','HTTP_PROXY','NO_PROXY']) {
  if (process.env[name]) env[name] = process.env[name];
}
const javaHome = process.env.SEEQ_TEST_JAVA_HOME || process.env.JAVA_HOME;
if (javaHome) { env.JAVA_HOME = javaHome; env.PATH = path.join(javaHome,'bin') + path.delimiter + (env.PATH || ''); }
env.DEBUG = ''; env.CI = '1';
fs.mkdirSync(path.join(root,'tmp'),{recursive:true});
env.FIREBASE_DEBUG_PATH = path.join(root,'tmp','exhibition-security-cli.log');
const java = spawnSync('java',['-version'],{env,encoding:'utf8',windowsHide:true});
if (java.error || java.status !== 0) {
  console.error('Java 21 이상이 필요합니다. 설치하거나 SEEQ_TEST_JAVA_HOME에 Java 폴더를 지정하세요.'); process.exit(1);
}
const result = spawnSync(process.execPath,[
  require.resolve('firebase-tools/lib/bin/firebase.js'), 'emulators:exec',
  '--only','database','--project','demo-seeq-exhibition-security','--config',path.join(root,'firebase.exhibition.json'),
  'node --test tests/exhibition-rules.emulator.test.cjs',
],{cwd:root,env,stdio:'inherit',windowsHide:true});
if(result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
