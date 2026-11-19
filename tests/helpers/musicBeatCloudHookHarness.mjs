import { englishBeatImports } from './musicBeatI18n.mjs';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { configureBeatWrites } from '../../app/veyrnox/_lib/music/beat/beatCompatibility.mjs';
import { createBeat } from '../../app/veyrnox/_lib/music/beat/beatDocument.mjs';

// Execute both production hooks with deterministic effects, timers and an in-memory
// revisioned store. No network, IndexedDB or React renderer is needed for these flows.
let activeRunner;
export let fixture;
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
  getBeat: async () => { fixture.beforeRead?.(); return { record: structuredClone(fixture.record), persistent: fixture.persistent }; },
  setCloudLink: async (id, captured, link) => { fixture.record.cloud = link; fixture.calls.push('link'); return {}; },
  updateBeat: async (doc, revision, options = {}) => {
    if (revision !== fixture.record.revision || options.current?.() === false) return { error: 'conflict' };
    fixture.record = { ...fixture.record, doc, updatedAt: doc.updatedAt, revision: revision + 1, cloud: options.link || fixture.record.cloud };
    fixture.calls.push('local-write'); return { revision: revision + 1, persistent: fixture.persistent };
  },
  subscribeBeats: () => () => {},
  loadCloudBeat: async (doc, cloud, options) => {
    if (options.expectedRevision !== fixture.record.revision || !options.current()) return { error: 'conflict' };
    fixture.record = { ...fixture.record, doc, cloud, updatedAt: doc.updatedAt, revision: fixture.record.revision + 1 };
    fixture.calls.push('cloud-read'); return {};
  },
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
  '/beatStore.js': ['getBeat', 'setCloudLink', 'updateBeat', 'subscribeBeats', 'createBeat', 'loadCloudBeat'],
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
const { useBeatCloudSync } = await import('../../app/veyrnox/_components/music/beat/useBeatCloudSync.js');
const { useBeatProject } = await import('../../app/veyrnox/_components/music/beat/useBeatProject.js');
hooks.deregister();
function runner(render) {
  const r = { slots: [], effects: [], dirty: true, cursor: 0, output: null,
    render() { activeRunner = r; r.cursor = 0; r.dirty = false; r.output = render(); for (const effect of r.effects.splice(0)) effect(); },
    close() { for (const slot of r.slots) slot?.cleanup?.(); },
  };
  return r;
}
export async function setup(t, { edited = false, newer = false, assets = {}, localVersion, writes = false, persistent = true } = {}) {
  configureBeatWrites(writes);
  const id = crypto.randomUUID(), userId = crypto.randomUUID(), projectId = crypto.randomUUID();
  const doc = { ...createBeat({ id, now: 1 }), assets };
  const cloud = { userId, projectId, revision: 1, syncedUpdatedAt: 1 };
  fixture = { userId, record: { id, doc: { ...doc, ...(localVersion ? { version: localVersion } : {}), updatedAt: edited ? 2 : 1 }, updatedAt: edited ? 2 : 1, revision: 1, cloud },
    persistent, calls: [], announcements: [], rows: [],
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
  t.after(() => { sync.close(); project.close(); configureBeatWrites(false); globalThis.window = priorWindow; globalThis.document = priorDocument; });
  return { project, sync, run, settle, timers };
}
export const saves = () => fixture.calls.filter(call => Array.isArray(call) && call[0] === 'save');
