const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(relative) {
  const filename = path.resolve(__dirname, '../lib', relative + '.ts');
  if (cache.has(filename)) return cache.get(filename);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => name.startsWith('./') ? load(name.slice(2)) : require(name), module, module.exports);
  cache.set(filename, module.exports);
  return module.exports;
}
const { parseHazardSignal, normalizeHazardUrl, HazardArbiter } = load('hazard-protocol');
const { openHazardSocket } = load('hazard-socket');
const signal = (event, timestamp = Date.now() / 1000, message = event) => ({ event, message, ttc: event === 'LEVEL1' ? 1.2 : null, timestamp });

test('accepts all four Python JSON event types and Unix seconds', () => {
  for (const event of ['LEVEL1', 'LEVEL2', 'CROSSWALK', 'GO']) {
    assert.equal(parseHazardSignal(JSON.stringify(signal(event))).event, event);
  }
});
test('ignores corrupt frames, unknown events and invalid fields', () => {
  for (const raw of ['not json', 'null', '{}', JSON.stringify(signal('UNKNOWN')),
    JSON.stringify({ ...signal('LEVEL1'), ttc: -1 }), JSON.stringify({ ...signal('LEVEL1'), message: '' }),
    JSON.stringify({ ...signal('LEVEL1'), timestamp: '123' }), 'x'.repeat(5000)]) {
    assert.equal(parseHazardSignal(raw), null);
  }
});
test('rejects buffered, future and milliseconds timestamps', () => {
  const now = Date.now();
  for (const time of [(now - 11000) / 1000, (now + 31000) / 1000, now]) {
    assert.equal(parseHazardSignal(JSON.stringify(signal('LEVEL1', time)), now), null);
  }
});
test('validates WebSocket protocol and disallows embedded credentials', () => {
  assert.equal(normalizeHazardUrl(' ws://192.168.0.20:5000 '), 'ws://192.168.0.20:5000/');
  assert.equal(normalizeHazardUrl('wss://example.org/events'), 'wss://example.org/events');
  for (const value of ['', 'http://host', 'tcp://host:5000', 'ws://user:password@host']) assert.throws(() => normalizeHazardUrl(value));
});
test('LEVEL1 suppresses GO and lower severity alerts while active', () => {
  const gate = new HazardArbiter();
  assert.equal(gate.accept(signal('LEVEL1', 100), 100000), 'play');
  assert.equal(gate.accept(signal('GO', 101), 101000), 'ignore');
  assert.equal(gate.accept(signal('LEVEL2', 101), 101000), 'ignore');
  assert.equal(gate.active.event, 'LEVEL1');
});
test('more urgent alerts interrupt lower priority output immediately', () => {
  const gate = new HazardArbiter();
  gate.accept(signal('CROSSWALK', 100), 100000);
  assert.equal(gate.accept(signal('LEVEL1', 100.5), 100500), 'play');
});
test('500ms LEVEL1 frames extend the warning without restarting its sound', () => {
  const gate = new HazardArbiter();
  gate.accept(signal('LEVEL1', 100), 100000);
  assert.equal(gate.accept(signal('LEVEL1', 100.5), 100500), 'refresh');
  assert.equal(gate.expiresAt, 103500);
  assert.equal(gate.accept(signal('LEVEL1', 103.1), 103100), 'play');
});
test('duplicate/out-of-order packets do not replay; expired alerts allow new events', () => {
  const gate = new HazardArbiter();
  gate.accept(signal('LEVEL1', 100), 100000);
  assert.equal(gate.accept(signal('LEVEL1', 100), 100200), 'ignore');
  assert.equal(gate.accept(signal('LEVEL1', 99), 100300), 'ignore');
  assert.equal(gate.accept(signal('GO', 104), 104000), 'play');
});

function fixture(timeSync = false) {
  const sockets = [], states = [], errors = [], received = [], timers = new Map();
  let nextId = 0, disconnections = 0;
  class FakeSocket {
    constructor(url) { this.url = url; this.closed = false; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.closed = true; }
  }
  const dependencies = {
    WebSocket: FakeSocket,
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  const close = openHazardSocket({
    timeSync, endpoint: 'ws://192.168.0.20:5000', onStatus: value => states.push(value), onError: value => errors.push(value),
    onSignal: value => received.push(value), onDisconnect: () => disconnections++,
  }, dependencies);
  const tick = delay => {
    const match = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(match, `Expected timer ${delay}`);
    timers.delete(match[0]); match[1].callback();
  };
  return { sockets, states, errors, received, timers, close, tick, get disconnections() { return disconnections; } };
}
test('socket accepts a real-format JSON message and ignores malformed input', () => {
  const f = fixture(), socket = f.sockets[0];
  socket.onopen();
  socket.onmessage({ data: JSON.stringify(signal('LEVEL1')) });
  socket.onmessage({ data: 'broken' });
  assert.equal(f.states.at(-1), '연결됨');
  assert.equal(f.received.length, 1);
  assert.ok(f.errors.at(-1));
  f.close();
});
test('failed connection retries, blocks old messages and recovers', () => {
  const f = fixture(), first = f.sockets[0];
  const lateMessage = first.onmessage;
  first.onerror();
  lateMessage({ data: JSON.stringify(signal('LEVEL1')) });
  assert.equal(f.received.length, 0);
  assert.equal(f.disconnections, 1);
  assert.equal(first.closed, true);
  f.tick(1000);
  assert.equal(f.sockets.length, 2);
  f.sockets[1].onopen();
  f.sockets[1].onmessage({ data: JSON.stringify(signal('GO')) });
  assert.equal(f.received[0].event, 'GO');
  f.close();
});
test('connection timeout retries and disposal cancels all timers/listeners', () => {
  const f = fixture();
  f.tick(8000);
  assert.equal(f.states.at(-1), '재연결 대기');
  f.close();
  assert.equal(f.timers.size, 0);
  assert.equal(f.sockets[0].onmessage, null);
});
test('retry backoff grows for unsuccessful attempts', () => {
  const f = fixture();
  f.sockets[0].onerror(); f.tick(1000);
  f.sockets[1].onerror(); f.tick(2000);
  f.sockets[2].onerror();
  assert.ok([...f.timers.values()].some(t => t.delay === 4000));
  f.close();
});

test('TIME_SYNC opt-in sends Unix seconds immediately and every minute, then stops on disposal', () => {
  const f = fixture(true);
  try {
    const ws = f.sockets[0];
    assert.equal(ws.sent.length, 0);
    const before = Date.now() / 1000;
    ws.onopen();
    assert.equal(ws.sent[0].event, 'TIME_SYNC');
    assert.ok(ws.sent[0].timestamp >= before && ws.sent[0].timestamp <= Date.now() / 1000);
    assert.deepEqual(Object.keys(ws.sent[0]).sort(), ['event', 'timestamp']);
    f.tick(60000);
    assert.equal(ws.sent.length, 2);
    assert.equal([...f.timers.values()].filter(t => t.delay === 60000).length, 1);
    const late = [...f.timers.values()].find(t => t.delay === 60000).callback;
    f.close();
    late();
    assert.equal(ws.sent.length, 2);
    assert.equal(f.timers.size, 0);
  } finally { f.close(); }
});

test('default socket callers do not enable time sync or alter web behavior', () => {
  const f = fixture();
  try {
    f.sockets[0].onopen();
    assert.equal(f.sockets[0].sent.length, 0);
    assert.equal(f.timers.size, 0);
  } finally { f.close(); }
});

test('TIME_SYNC timer is cleared on disconnect and re-created for the new connection', () => {
  const f = fixture(true);
  try {
    const first = f.sockets[0]; first.onopen();
    const late = [...f.timers.values()].find(t => t.delay === 60000).callback;
    first.onclose({ code: 1000, reason: 'test disconnect', wasClean: true });
    assert.ok(![...f.timers.values()].some(t => t.delay === 60000));
    late();
    assert.equal(first.sent.length, 1);
    f.tick(1000);
    const next = f.sockets[1]; next.onopen();
    assert.equal(next.sent.length, 1);
    f.tick(60000);
    assert.equal(first.sent.length, 1);
    assert.equal(next.sent.length, 2);
  } finally { f.close(); }
});

test('TIME_SYNC send failure reconnects without claiming connection success', () => {
  const f = fixture(true);
  try {
    f.sockets[0].send = () => { throw Error('sync transport failed'); };
    f.sockets[0].onopen();
    assert.equal(f.states.at(-1), '재연결 대기');
    assert.ok(!f.states.includes('연결됨'));
    assert.ok(![...f.timers.values()].some(t => t.delay === 60000));
    f.tick(1000);
    f.sockets[1].onopen();
    assert.equal(f.sockets[1].sent[0].event, 'TIME_SYNC');
  } finally { f.close(); }
});

test('TIME_SYNC never relabels stale packets as fresh or extends the ten-second limit', () => {
  const f = fixture(true);
  try {
    const ws = f.sockets[0]; ws.onopen();
    ws.onmessage({ data: JSON.stringify(signal('LEVEL1', Date.now() / 1000 - 7181)) });
    assert.equal(f.received.length, 0);
    ws.onmessage({ data: JSON.stringify(signal('LEVEL2')) });
    assert.equal(f.received.length, 1);
    assert.equal(f.received[0].event, 'LEVEL2');
  } finally { f.close(); }
});
