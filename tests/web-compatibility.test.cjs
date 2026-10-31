const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name in mocks) return mocks[name];
    if (name.endsWith('.css')) return {};
    if (name === 'react-native-maps') throw new Error('Native maps were imported on web');
    return require(name);
  }, module, module.exports);
  return module.exports;
}
function rnMock() {
  const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value ?? {};
  return { View: ({ children, style }) => React.createElement('div', { style: flatten(style) }, children), Text: ({ children, style }) => React.createElement('span', { style: flatten(style) }, children), StyleSheet: { create: value => value } };
}

test('web map renders real Leaflet map, markers and route; native code never loads', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  global.window = dom.window; global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement; global.Element = dom.window.Element;
  global.SVGElement = dom.window.SVGElement; global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
  global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.SVGSVGElement.prototype.createSVGRect = () => ({});
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  const { createRoot } = require('react-dom/client');
  const { default: Map, Marker, Polyline } = load('components/maps/seeq-map.web.tsx', { 'react-native': rnMock() });
  const mounted = createRoot(document.getElementById('root'));
  const ref = React.createRef();
  const coords = [{ latitude: 37.5665, longitude: 126.978 }, { latitude: 37.568, longitude: 126.981 }];
  let ready = false;
  try {
    await React.act(async () => {
      mounted.render(React.createElement(Map, { ref, style: { width: 800, height: 600 }, initialRegion: { ...coords[0], latitudeDelta: 0.02, longitudeDelta: 0.02 }, onMapReady: () => { ready = true; } },
        React.createElement(Polyline, { coordinates: coords, strokeColor: '#3B82F6', strokeWidth: 6 }),
        React.createElement(Marker, { coordinate: coords[1], title: 'destination' })));
    });
    assert.equal(ready, true);
    assert.ok(document.querySelector('.leaflet-container'));
    assert.ok(document.querySelector('path[stroke="#3B82F6"]'));
    assert.ok(document.querySelector('path[fill="#D2FF00"]'));
    assert.ok(document.querySelector('.leaflet-control-attribution a[href*="openstreetmap"]'));
    await React.act(async () => {
      ref.current.fitToCoordinates(coords, { animated: false });
      ref.current.animateToRegion({ ...coords[0], latitudeDelta: 0.01, longitudeDelta: 0.01 });
    });
  } finally {
    await React.act(async () => mounted.unmount());
    dom.window.close();
    delete global.window; delete global.document;
  }
});

test('unsupported browser notifications and sensors are safe and do not invent a heading', async () => {
  delete global.Notification;
  const notifications = load('lib/platform/notifications.web.ts');
  assert.equal((await notifications.requestPermissionsAsync()).granted, false);
  assert.match(await notifications.scheduleNotificationAsync({ content: { title: 'test' }, trigger: null }), /^seeq-web-/);
  let called = false;
  const { Magnetometer } = load('lib/platform/sensors.web.ts');
  const subscription = Magnetometer.addListener(() => { called = true; });
  subscription.remove(); Magnetometer.setUpdateInterval(1000);
  assert.equal(called, false);
});

test('supported browser notifications display the actual message', async () => {
  let notification;
  global.Notification = class { static permission = 'granted'; constructor(title, options) { notification = { title, ...options }; } };
  const api = load('lib/platform/notifications.web.ts');
  await api.scheduleNotificationAsync({ content: { title: 'SOS', body: 'help requested' }, trigger: null });
  assert.equal(notification.title, 'SOS'); assert.equal(notification.body, 'help requested');
  delete global.Notification;
});

test('web vibration is optional; a supported browser receives the requested pattern', () => {
  const calls = [];
  Object.defineProperty(global, 'navigator', { configurable: true, value: {} });
  const { Vibration } = load('lib/platform/vibration.web.ts');
  Vibration.vibrate([0, 200]); Vibration.cancel();
  global.navigator.vibrate = value => calls.push(value);
  Vibration.vibrate([0, 200, 100, 200]); Vibration.cancel();
  assert.deepEqual(calls, [[0, 200, 100, 200], 0]);
});

test('HTTPS web blocks insecure Pi websocket without stopping local warning tests', () => {
  global.window = { location: { protocol: 'https:' } };
  let opened = false, error = '';
  const api = load('lib/hazard-socket.web.ts', { './hazard-socket-core': { openHazardSocket: () => { opened = true; return () => {}; } } });
  const cleanup = api.openHazardSocket({ endpoint: 'ws://10.42.0.1:5000', onStatus: () => {}, onError: value => { error = value; } });
  assert.equal(opened, false); assert.match(error, /wss:\/\//); cleanup();
  api.openHazardSocket({ endpoint: 'wss://example.org/events', onStatus: () => {}, onError: () => {} });
  assert.equal(opened, true);
  delete global.window;
});

test('real web geolocation is returned unchanged and watch cleanup is preserved', async () => {
  global.window = { isSecureContext: true };
  let cleared;
  const real = { timestamp: 123, coords: { latitude: 35.1, longitude: 129.1, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null } };
  Object.defineProperty(global, 'navigator', { configurable: true, value: { geolocation: {
    getCurrentPosition: callback => callback(real), watchPosition: callback => { callback(real); return 7; }, clearWatch: id => { cleared = id; },
  } } });
  const api = load('lib/platform/location.web.ts', { expo: { PermissionStatus: { GRANTED: 'granted', DENIED: 'denied' } }, 'expo-location': { Accuracy: {}, reverseGeocodeAsync: () => {} } });
  assert.equal((await api.getCurrentPositionAsync()).coords.latitude, real.coords.latitude);
  assert.equal((await api.requestForegroundPermissionsAsync()).status, 'granted');
  let received;
  const subscription = await api.watchPositionAsync({}, value => { received = value; });
  assert.equal(received.coords.longitude, real.coords.longitude);
  subscription.remove(); assert.equal(cleared, 7);
  global.window.isSecureContext = false;
  assert.equal((await api.requestForegroundPermissionsAsync()).status, 'denied');
  delete global.window;
});

test('web alert confirmation and text prompt preserve guardian approval callbacks', () => {
  let approved = false, entered;
  global.window = { confirm: () => true, prompt: () => 'ABC123', alert: () => {} };
  const api = load('lib/app-alert.web.ts', { './app-speech': { describeButton: () => {}, getSpeechRevision: () => 0 } });
  api.AppAlert.alert('connection', 'approve?', [{ text: 'cancel', style: 'cancel' }, { text: 'approve', onPress: () => { approved = true; } }]);
  api.AppAlert.prompt('pair code', '', [{ text: 'cancel', style: 'cancel' }, { text: 'connect', onPress: code => { entered = code; } }]);
  assert.equal(approved, true); assert.equal(entered, 'ABC123');
  delete global.window;
});

test('native map and device adapters keep their original libraries', () => {
  assert.match(fs.readFileSync(path.join(root, 'components/maps/seeq-map.native.tsx'), 'utf8'), /export \{ default, Marker, Polyline \} from 'react-native-maps'/);
  for (const [name, original] of [['location', 'expo-location'], ['notifications', 'expo-notifications'], ['sensors', 'expo-sensors'], ['vibration', 'react-native']]) {
    assert.ok(fs.readFileSync(path.join(root, 'lib/platform', name + '.native.ts'), 'utf8').includes(original));
  }
});

test('demonstration coordinates are kept out of the Firebase GPS state', () => {
  for (const file of ['index.tsx', 'index.final.tsx']) {
    const code = fs.readFileSync(path.join(root, 'app/(tabs)', file), 'utf8');
    const calls = [...code.matchAll(/setMyLocation\(([^)]+)\)/g)].map(match => match[1]);
    assert.deepEqual(calls, ['current', 'location']);
    assert.match(code, /const webDisplayLocation = myLocation \|\| \(webDemoOrigin/);
  }
});
