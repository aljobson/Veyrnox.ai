import { englishBeatImports } from './helpers/musicBeatI18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';

// Execute both production hooks with deterministic effects, timers and an in-memory
// revisioned store. No network, IndexedDB or React renderer is needed for these flows.
let activeRunner, fixture;
globalThis.beatHookFixture = {
  useI18n: englishBeatImports['../../../../../components/I18nProvider'].useI18n,
  subscribeShelf: () => () => {},
  useRef(value) { const r = activeRunner, i = r.cursor++; return r.slots[i] ||= { current: value }; },
  useState(value) {
    const r = activeRunner, i = r.cursor++;
    if (!(i in r.slots)) r.slots[i] = value;
    return [r.slots[i], next => { r.slots[i] = typeof next === 'function' ? next(r.slots[i]) : next; r.dirty = true; }];
  },
  useEffect(effect, deps) {
    const r = activeRunner, i = r.cursor++, old = r.slots[i];
    if (!old || !deps || deps.some((d, n) => d !== old.deps?.[n])) {
      r.effects.push(() => { old?.cleanup?.(); r.slots[i] = { deps, cleanup: effect() }; });
    }
  },
  useCallback(fn, deps) {
    const r = activeRunner, i = r.cursor++, old = r.slots[i];
    if (!old || deps.some((d, n) => d !== old.deps[n])) r.slots[i] = { deps, fn };
    return r.slots[i].fn;
  },
  getStoredUserId: () => fixture.userId,
  onSessionChange: () => () => {},
  getBeat: async () => ({ record: structuredClone(fixture.record), persistent: true }),
  setCloudLink: async (id, captured, link) => { fixture.record.cloud = link; fixture.calls.push('link'); return {}; },
  updateBeat: async (doc, revision, options = {}) => {
    if (revision !== fixture.record.revision || options.current?.() === false) return { error: 'conflict' };
    fixture.record = { ...fixture.record, doc, updatedAt: doc.updatedAt, revision: revision + 1, cloud: options.link || fixture.record.cloud };
    fixture.calls.push('local-write'); return { revision: revision + 1, persistent: true };
  },
  subscribeBeats: () => () => {},
  createBeat: async () => { throw Error('Unexpected copy'); },
  getShelf: () => [], hydrateShelf: async () => {},
  configureCloudTakes: () => {},
  getCloudBeat: async () => { fixture.calls.push('get'); return fixture.get(); },
  saveCloudBeat: async (id, body) => { fixture.calls.push(['save', body]); return fixture.save(body); },
  listTakes: async () => { fixture.calls.push('takes'); return { takes: fixture.rows }; },
  uploadTake: async (id, asset) => { fixture.calls.push(['upload', asset.ref]); return fixture.upload(asset); },
  takeUrl: async () => {},
};
const exportsByFile = {
  'beat:i18n': ['useI18n'],
  '/react/index.js': ['useRef', 'useState', 'useEffect', 'useCallback'],
  '/authClient.js': ['getStoredUserId', 'onSessionChange'],
  '/beatStore.js': ['getBeat', 'setCloudLink', 'updateBeat', 'subscribeBeats', 'createBeat'],
  '/beatCloud.js': ['getCloudBeat', 'saveCloudBeat', 'listTakes', 'uploadTake', 'takeUrl'],
  '/beatAssets.js': ['configureCloudTakes'],
  '/instrumentShelf.js': ['getShelf', 'hydrateShelf', 'subscribeShelf'],
};
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier.endsWith('/components/I18nProvider') ? { url: 'beat:i18n', shortCircuit: true } : next(specifier, context);
}, load(url, context, next) {
  for (const [suffix, names] of Object.entries(exportsByFile)) if (url.endsWith(suffix))
    return { format: 'module', shortCircuit: true, source: `export const { ${names.join(', ')} } = globalThis.beatHookFixture;` };
  return next(url, context);
} });
const { useBeatCloudSync } = await import('../app/veyrnox/_components/music/beat/useBeatCloudSync.js');
const { useBeatProject } = await import('../app/veyrnox/_components/music/beat/useBeatProject.js');
hooks.deregister();
function runner(render) {
  const r = { slots: [], effects: [], dirty: true, cursor: 0, output: null,
    render() { activeRunner = r; r.cursor = 0; r.dirty = false; r.output = render(); for (const effect of r.effects.splice(0)) effect(); },
    close() { for (const slot of r.slots) slot?.cleanup?.(); },
  };
  return r;
}
async function setup(t, { edited = false, newer = false, assets = {}, localVersion } = {}) {
  const id = crypto.randomUUID(), userId = crypto.randomUUID(), projectId = crypto.randomUUID();
  const doc = { ...createBeat({ id, now: 1 }), assets };
  const cloud = { userId, projectId, revision: 1, syncedUpdatedAt: 1 };
  fixture = { userId, record: { id, doc: { ...doc, ...(localVersion ? { version: localVersion } : {}), updatedAt: edited ? 2 : 1 }, updatedAt: edited ? 2 : 1, revision: 1, cloud },
    calls: [], announcements: [], rows: [],
    get: async () => ({ project: { id: projectId, revision: newer ? 2 : 1 }, doc_json: JSON.stringify({ ...doc, title: newer ? 'From account' : doc.title, updatedAt: newer ? 3 : 1 }) }),
    save: async body => ({ project: { id: projectId, revision: body.expected_revision + 1 } }),
    upload: async asset => ({ id: asset.ref, status: 'ready' }),
  };
  const timers = new Map(); let timerId = 0;
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  const priorWindow = globalThis.window, priorDocument = globalThis.document;
  globalThis.window = new EventTarget(); globalThis.document = new EventTarget();
  const announce = text => fixture.announcements.push(text);
  const project = runner(() => useBeatProject(id, announce));
  const sync = runner(() => useBeatCloudSync({ beatId: id, project: project.output, cloud: true, announce }));
  async function settle() {
    for (let i = 0; i < 30; i++) {
      if (project.dirty) { project.render(); sync.dirty = true; }
      if (sync.dirty) sync.render();
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  project.render(); sync.render(); await settle();
  async function run(delay) {
    const item = [...timers].find(([, timer]) => delay === undefined || timer.delay === delay);
    assert.ok(item, `expected a timer for ${delay}`);
    timers.delete(item[0]); item[1].fn(); await settle();
  }
  t.after(() => { sync.close(); project.close(); globalThis.window = priorWindow; globalThis.document = priorDocument; });
  return { project, sync, run, settle, timers };
}
const saves = () => fixture.calls.filter(call => Array.isArray(call) && call[0] === 'save');
test('a valid version-5 local record opens in an update-required state, never as an editable document', async t => {
  const h = await setup(t, { edited: true, localVersion: 5 });
  assert.equal(h.project.output.error, 'update_required');
  assert.ok(!h.project.output.doc, 'the editor must not receive the v5 document');
  assert.equal(fixture.record.doc.version, 5);
  assert.equal(fixture.calls.includes('local-write'), false);
  assert.equal(saves().length, 0);
});
test('unchanged open reads once, never writes or lists absent takes', async t => {
  const h = await setup(t); await h.run();
  assert.deepEqual(fixture.calls, ['get']);
  assert.equal(h.sync.output.state, 'synced');
  assert.equal(h.project.output.doc.title, fixture.record.doc.title);
});
test('newer account revision quietly replaces, updates link and reloads without stash or PUT', async t => {
  const h = await setup(t, { newer: true }); await h.run();
  assert.deepEqual(fixture.calls, ['get', 'local-write']);
  assert.equal(fixture.record.cloud.revision, 2);
  assert.equal(fixture.record.cloud.syncedUpdatedAt, 3);
  assert.equal(h.project.output.doc.title, 'From account');
  assert.equal(fixture.announcements.at(-1), 'Updated from your account');
  assert.equal(h.project.output.canUndo, false);
  await h.run(); assert.equal(saves().length, 0);
});
test('a saved local edit writes its original expected revision and opens the normal conflict', async t => {
  const h = await setup(t, { edited: true, newer: true });
  fixture.save = async () => { throw { code: 'VERSION_CONFLICT', status: 409 }; };
  await h.run();
  assert.equal(saves().length, 1); assert.equal(saves()[0][1].expected_revision, 1);
  assert.equal(h.sync.output.state, 'conflict'); assert.equal(h.sync.output.conflict.revision, 2);
  assert.equal(fixture.record.doc.updatedAt, 2);
});
test('an unsaved edit during the open GET aborts quiet replacement and later conflicts normally', async t => {
  const h = await setup(t, { newer: true });
  const get = fixture.get;
  fixture.get = async () => {
    h.project.output.edit(doc => ({ ...doc, title: 'Edited during GET', updatedAt: 4 }));
    return get();
  };
  await h.run();
  assert.equal(fixture.record.doc.title, 'Edited during GET');
  assert.equal(fixture.record.cloud.revision, 1);
  assert.ok(!fixture.announcements.includes('Updated from your account'));
  fixture.get = get; fixture.save = async () => { throw { code: 'VERSION_CONFLICT', status: 409 }; };
  await h.run(10000);
  assert.equal(h.sync.output.state, 'conflict');
  assert.equal(JSON.parse(saves()[0][1].doc_json).title, 'Edited during GET');
});
test('NOT_FOUND clears the link, stops automatic saves and re-creates only on the explicit button', async t => {
  const h = await setup(t, { edited: true });
  fixture.save = async () => { throw { code: 'NOT_FOUND', status: 404 }; };
  await h.run();
  assert.equal(h.sync.output.state, 'removed');
  assert.equal(h.sync.output.message, 'Removed from your account — Save to your account');
  assert.deepEqual(fixture.record.cloud, { userId: fixture.userId, projectId: null, revision: 0 });
  assert.equal(h.timers.size, 0);
  fixture.save = async () => ({ project: { id: crypto.randomUUID(), revision: 1 } });
  await h.sync.output.link(); await h.settle();
  assert.equal(saves().length, 2); assert.equal(saves()[1][1].expected_revision, 0);
  assert.equal(h.sync.output.state, 'synced');
});
const takes = Object.fromEntries(['one', 'two', 'three'].map(ref => [`a${ref}`, { source: 'take', ref, name: ref, durationSec: 1, sourceChannels: 1, encodedBytes: 44, bpm: null }]));
for (const [status, code] of [[400, 'INVALID_REQUEST'], [401, 'UNAUTHORIZED'], [403, 'TAKE_UPLOAD_FAILED'],
  [404, 'NOT_FOUND'], [409, 'take_upload_invalid'], [413, 'TAKE_UPLOAD_FAILED'], [undefined, 'ENCODE_FAILED']]) {
  test(`${status} ${code} refuses only that take and stops its retry timer`, async t => {
    const h = await setup(t, { assets: takes });
    fixture.upload = async asset => {
      if (asset.ref === 'one') throw { status, code };
      return { id: asset.ref, status: 'ready' };
    };
    await h.run();
    assert.deepEqual(h.sync.output.media, ['one']);
    assert.equal(h.timers.size, 0);
    // Later document saves must not retry the refused ref either.
    await h.sync.output.checkpoint(); await h.settle();
    assert.equal(fixture.calls.filter(c => Array.isArray(c) && c[0] === 'upload' && c[1] === 'one').length, 1);
    assert.deepEqual(h.sync.output.media, ['one']);
    assert.equal(h.timers.size, 0);
  });
}
for (const error of [{ status: 503, code: 'TAKE_UPLOAD_FAILED' }, { code: 'NETWORK_ERROR' },
  { status: 409, code: 'take_upload_missing' }, { status: 408, code: 'TAKE_UPLOAD_FAILED' },
  { status: 429, code: 'TAKE_UPLOAD_FAILED' }, { status: 429, code: 'OTHER_LIMIT' }]) {
  test(`${error.code} ${error.status || 'network'} keeps the existing media retry`, async t => {
    const h = await setup(t, { assets: { aone: takes.aone } });
    fixture.upload = async () => { throw error; };
    await h.run();
    assert.deepEqual(h.sync.output.media, ['one']);
    assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [60000]);
    fixture.upload = async asset => ({ id: asset.ref, status: 'ready' });
    await h.run(60000);
    assert.deepEqual(h.sync.output.media, []);
    assert.equal(fixture.calls.filter(c => Array.isArray(c) && c[0] === 'upload').length, 2);
    assert.equal(h.timers.size, 0);
  });
}
test('takes list once per cycle and successful uploads need no second listing', async t => {
  const h = await setup(t, { assets: takes }); await h.run();
  assert.equal(fixture.calls.filter(c => c === 'takes').length, 1);
  assert.equal(fixture.calls.filter(c => Array.isArray(c) && c[0] === 'upload').length, 3);
  assert.deepEqual(h.sync.output.media, []);
});
for (const code of ['RATE_LIMITED', 'LIMIT_REACHED']) test(`${code} stops take uploads; only rate limits schedule remaining takes`, async t => {
  const h = await setup(t, { assets: takes });
  fixture.upload = async () => { throw { code, status: 429 }; };
  await h.run();
  assert.equal(fixture.calls.filter(c => c === 'takes').length, 1);
  assert.equal(fixture.calls.filter(c => Array.isArray(c) && c[0] === 'upload').length, 1);
  assert.deepEqual(h.sync.output.media, ['one', 'two', 'three']);
  assert.equal([...h.timers.values()].some(t => t.delay === 60000), code === 'RATE_LIMITED');
  if (code === 'RATE_LIMITED') {
    fixture.upload = async asset => ({ id: asset.ref, status: 'ready' });
    await h.run(60000); assert.deepEqual(h.sync.output.media, []);
    assert.equal(fixture.calls.filter(c => c === 'takes').length, 2);
  }
});

test('a persisted removed link remains read-only on reopen until explicit save', async t => {
  const h = await setup(t);
  fixture.record.cloud = { userId: fixture.userId, projectId: null, revision: 0 };
  await h.run();
  assert.equal(h.sync.output.state, 'removed'); assert.deepEqual(fixture.calls, []);
  await h.sync.output.checkpoint(); await h.settle();
  assert.deepEqual(fixture.calls, []);
});
test('removal while resolving Keep mine clears the conflict and stops retries', async t => {
  const h = await setup(t, { edited: true, newer: true });
  fixture.save = async () => { throw { code: 'VERSION_CONFLICT', status: 409 }; };
  await h.run(); assert.equal(h.sync.output.state, 'conflict');
  fixture.save = async () => { throw { code: 'NOT_FOUND', status: 404 }; };
  await h.sync.output.resolve('mine'); await h.settle();
  assert.equal(h.sync.output.state, 'removed'); assert.equal(h.sync.output.conflict, null);
  assert.equal(h.timers.size, 0);
});
test('Load theirs retries a take that a background cycle refused', async t => {
  const h = await setup(t, { edited: true, assets: { aone: takes.aone } });
  fixture.upload = async () => { throw { status: 403, code: 'TAKE_UPLOAD_FAILED' }; };
  await h.run();
  assert.deepEqual(h.sync.output.media, ['one']);
  fixture.record = { ...fixture.record, doc: { ...fixture.record.doc, updatedAt: 5 }, updatedAt: 5 };
  fixture.save = async () => { throw { code: 'VERSION_CONFLICT', status: 409 }; };
  fixture.get = async () => ({ project: { id: fixture.record.cloud.projectId, revision: 2 }, doc_json: JSON.stringify({ ...fixture.record.doc, title: 'Theirs', updatedAt: 6 }) });
  await h.sync.output.checkpoint(); await h.settle();
  assert.equal(h.sync.output.state, 'conflict');
  const before = fixture.calls.filter(c => Array.isArray(c) && c[0] === 'upload').length;
  fixture.upload = async asset => ({ id: asset.ref, status: 'ready' });
  await h.sync.output.resolve('theirs'); await h.settle();
  assert.equal(fixture.calls.filter(c => Array.isArray(c) && c[0] === 'upload').length, before + 1);
  assert.deepEqual(h.sync.output.media, []);
});
test('a transient upload failure is not retried by a document save before its deadline', async t => {
  const h = await setup(t, { edited: true, assets: { aone: takes.aone } });
  fixture.upload = async () => { throw { status: 429, code: 'TAKE_UPLOAD_FAILED' }; };
  await h.run();
  const uploads = () => fixture.calls.filter(c => Array.isArray(c) && c[0] === 'upload').length;
  assert.equal(uploads(), 1);
  fixture.upload = async asset => ({ id: asset.ref, status: 'ready' });
  await h.sync.output.checkpoint(); await h.settle();
  assert.ok(saves().length >= 2, 'the document save still runs');
  assert.equal(uploads(), 1, 'the take waits for its retry deadline');
  assert.deepEqual(h.sync.output.media, ['one']);
  await h.run(60000);
  assert.equal(uploads(), 2); assert.deepEqual(h.sync.output.media, []);
});

test('BEAT_CLIENT_OUTDATED stops automatic retries and announces update required', async t => {
  const h = await setup(t, { edited: true });
  fixture.save = async () => { throw { code: 'BEAT_CLIENT_OUTDATED', status: 409 }; };
  await h.run();
  assert.equal(h.sync.output.state, 'update_required');
  assert.match(h.sync.output.message, /Update the app/);
  assert.equal(h.timers.size, 0);
  const count = saves().length;
  await h.sync.output.checkpoint(); await h.settle();
  assert.equal(saves().length, count); assert.equal(h.timers.size, 0);
});
for (const version of [5, 6, 999]) test(`cloud open v${version} refuses persistence without writes, stash or retry`, async t => {
  const h = await setup(t, { newer: true });
  const raw = JSON.stringify({ ...fixture.record.doc, version, ...(version === 5 ? { markers: [{ id: 'a', name: 'Intro', tick: 3 }] } : {}) });
  const before = JSON.stringify(fixture.record);
  fixture.get = async () => ({ project: { id: fixture.record.cloud.projectId, revision: 2 }, doc_json: raw });
  await h.run();
  assert.equal(h.sync.output.state, 'update_required'); assert.equal(h.timers.size, 0);
  assert.equal(JSON.stringify(fixture.record), before); assert.deepEqual(fixture.calls, ['get']);
});
test('outdated response while resolving a conflict clears the conflict and never retries', async t => {
  const h = await setup(t, { edited: true, newer: true });
  fixture.save = async () => { throw { code: 'VERSION_CONFLICT', status: 409 }; };
  await h.run();
  fixture.save = async () => { throw { code: 'BEAT_CLIENT_OUTDATED', status: 409 }; };
  await h.sync.output.resolve('mine'); await h.settle();
  assert.equal(h.sync.output.state, 'update_required'); assert.equal(h.sync.output.conflict, null); assert.equal(h.timers.size, 0);
});
