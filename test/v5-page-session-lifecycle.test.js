import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const source = fs.readFileSync(new URL('../v5/app.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

function harness({ pendingWorker = false } = {}) {
  const channels = [], messages = [], redirects = [], nodes = new Map(), media = [];
  let resolveFeed, resolveWorker;
  const feed = new Promise(r => { resolveFeed = r; });
  const workerReady = pendingWorker ? new Promise(r => { resolveWorker = r; }) : Promise.resolve();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', checked: true, hidden: false, textContent: '', innerHTML: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, querySelectorAll: () => [] });
    return nodes.get(id);
  };
  class BC { constructor(name) { this.name = name; this.listener = null; channels.push(this); } addEventListener(type, fn) { this.listener = fn; } postMessage() {} }
  class MC { constructor() { this.port1 = {}; this.port2 = { postMessage: data => queueMicrotask(() => this.port1.onmessage?.({ data })) }; } }
  const context = vm.createContext({
    document: { getElementById: get, querySelectorAll: selector => selector === 'video,audio' ? media : [], addEventListener() {}, body: { style: {} } },
    window: { BroadcastChannel: BC }, BroadcastChannel: BC, MessageChannel: MC,
    navigator: { serviceWorker: { register: async () => ({}), ready: workerReady, controller: { postMessage(message, ports) { messages.push(message); ports[0].postMessage({ ok: true }); } } } },
    location: { search: '?course=fixture-course', replace: url => redirects.push(url) },
    crypto, URL, URLSearchParams, localStorage: { getItem: () => null, setItem() {} },
    fetch: () => feed, setTimeout, clearTimeout, queueMicrotask, console, addEventListener() {},
    buildV5ViewModel: payload => payload.lessons || [], buildTimelineOutline: () => [], normalizeSearch: value => value
  });
  // Only presentation imports are doubled; normal page initialization and its
  // session/feed lifecycle execute from the shipped source.
  vm.runInContext(source.replace(/^import[^\n]*\n/, ''), context);
  vm.runInContext('render = payload => { data = payload; lessons = payload.lessons || []; };', context);
  return {
    channels, messages, redirects, media, state: code => vm.runInContext(code, context),
    feed: () => resolveFeed({ ok: true, status: 200, json: async () => ({ success: true, mediaSessionContext: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', lessons: [] }) }),
    ready: () => resolveWorker?.(), clear: () => channels[0]?.listener({ data: { type: 'clear' } })
  };
}

test('Normal V5 boot subscribes before feed; remote CLEAR rejects the delayed old feed', async () => {
  const h = harness();
  assert.equal(h.channels.length, 1);
  h.clear(); h.feed(); await settle();
  assert.equal(h.state('data'), null);
  assert.equal(h.state('mediaSessionContext'), '');
  assert.equal(h.messages.filter(m => m.type === 'v5-set-session-context').length, 0);
  assert.deepEqual(h.redirects, ['/my-courses.html']);
});

test('V5 remote CLEAR while worker setup is pending leaves no old worker context', async () => {
  const h = harness({ pendingWorker: true });
  h.feed(); await settle();
  h.clear(); h.ready(); await settle();
  assert.equal(h.state('data'), null);
  assert.equal(h.state('mediaSessionContext'), '');
  assert.equal(h.messages.at(-1).type, 'v5-clear-session');
});

test('V5 remote CLEAR stops active media and remote messages cannot install another context', async () => {
  const h = harness();
  h.feed(); await settle();
  const ownContext = h.state('mediaSessionContext');
  h.channels[0].listener({ data: { type: 'set', context: 'other-tab-context' } });
  assert.equal(h.state('mediaSessionContext'), ownContext);
  let pauses = 0, removes = 0, loads = 0;
  h.media.push({ pause: () => pauses++, removeAttribute: () => removes++, load: () => loads++ });
  h.clear(); await settle();
  assert.equal(pauses, 1); assert.equal(removes, 1); assert.equal(loads, 1);
  assert.equal(h.state('data'), null);
  assert.equal(h.state('mediaSessionContext'), '');
});
