import test from 'node:test';
import assert from 'node:assert/strict';
import { jobsToWatch, WATCH_MAX_AGE_MS } from '../app/veyrnox/_lib/jobHistory.js';
import { publicJob, JOB_STATES } from '../lib/jobState.js';
import { createSwapActions } from '../app/veyrnox/_lib/templateSwapActions.mjs';
import { createSwapStore } from '../app/veyrnox/_lib/templateSwapStore.mjs';

test('only unsettled jobs from the last hour are watched', () => {
    const now = 1_000_000_000_000;
    const history = [
        { job_id: 'a', submitted_at: now - 60_000 },
        { job_id: 'b', submitted_at: now - 60_000, settled: 'succeeded' },
        { job_id: 'c', submitted_at: now - WATCH_MAX_AGE_MS - 1 },
        { job_id: 'd' },
        null,
    ];
    assert.deepEqual(jobsToWatch(history, now).map((r) => r.job_id), ['a']);
    assert.deepEqual(jobsToWatch(undefined, now), []);
});

import { createGenerationClaimer } from '../app/veyrnox/_lib/generationClaim.mjs';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function memoryStorage() {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k), data };
}
function serializedLocks() {
  let tail = Promise.resolve();
  return { request: (_key, run) => { const result = tail.then(run); tail = result.catch(() => {}); return result; } };
}
test('two tabs and competing completion paths share one persistent claim', async () => {
  const storage = memoryStorage(), locks = serializedLocks();
  const one = createGenerationClaimer(), two = createGenerationClaimer();
  const input = { owner:'A', id:'job', submittedAt:Date.now(), currentOwner:()=> 'A', settle:()=>true, storage, locks };
  assert.deepEqual(await Promise.all([one(input), two(input), one(input)]), [true,false,false]);
  assert.equal(await createGenerationClaimer()(input), false, 'reload cannot announce the claim');
  assert.equal(await two({...input,owner:'B',currentOwner:()=> 'B'}), true, 'account scoped');
});
test('claim excludes old, missing-time, future, replayed and stale-account results', async () => {
  const claim = createGenerationClaimer(), now = Date.now();
  const base = {owner:'A',id:'j',submittedAt:now,currentOwner:()=> 'A',settle:()=>true,storage:memoryStorage(),now};
  for (const patch of [{submittedAt:now-WATCH_MAX_AGE_MS},{submittedAt:undefined},{submittedAt:now+1},{settle:()=>false},{currentOwner:()=> 'B'}]) assert.equal(await claim({...base,...patch}),false);
});
test('same-tab fallback deduplicates even when storage is denied', async () => {
  const claim = createGenerationClaimer();
  const input = { owner:'A',id:'j',submittedAt:Date.now(),currentOwner:()=> 'A',settle:()=>true,storage:{getItem(){throw Error();},setItem(){throw Error();}} };
  assert.equal(await claim(input),true); assert.equal(await claim(input),false);
});
function historyHarness() {
  const storage = memoryStorage(), events = [], moodOptions = [];
  globalThis.localStorage = storage;
  globalThis.window = {dispatchEvent:e => events.push(e)};
  const mod={exports:{}};
  const source=ts.transpileModule(readFileSync(new URL('../app/veyrnox/_lib/jobHistory.js',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('require','module','exports',source)(id => {
    if(id.includes('authClient')) return {getSession:()=>({user:{id:'A'}})};
    if(id.includes('veyMood')) return {signalVeyMood:()=>{},veyErrorSituation:(code, options)=>{moodOptions.push({code,...options});return null;}};
    if(id.includes('generationClaim')) return {createGenerationClaimer,WATCH_MAX_AGE_MS};
    throw Error(id);
  },mod,mod.exports);
  return {...mod.exports,events,storage,moodOptions};
}
test('history upsert preserves settlement/time and strips signed asset URLs', async () => {
  const h=historyHarness(), submitted_at=Date.now()-100;
  try {
    h.pushJobHistory({job_id:'j',submitted_at,asset_url:'https://signed.invalid',url:'https://signed.invalid'});
    await h.markJobSettled('j','succeeded');
    h.pushJobHistory({job_id:'j',submitted_at:Date.now(),idempotent:true});
    assert.equal(h.readJobHistory()[0].submitted_at,submitted_at);
    assert.equal(h.readJobHistory()[0].settled,'succeeded');
    await h.markJobSettled('j','succeeded');
    assert.equal(h.events.filter(e=>e.type===h.GENERATION_SUCCEEDED_EVENT).length,1);
    assert.ok(!JSON.stringify([...h.storage.data]).includes('signed.invalid'));
  } finally {delete globalThis.localStorage;delete globalThis.window;}
});
test('unchanged running reads do not broadcast job-history changes', async () => {
  const h = historyHarness();
  try {
    h.pushJobHistory({ job_id: 'running' });
    let changes = h.events.filter(e => e.type === h.JOBS_CHANGED_EVENT).length;
    await h.markJobSettled('running', 'running');
    assert.equal(h.events.filter(e => e.type === h.JOBS_CHANGED_EVENT).length, changes);

    h.pushJobHistory({ job_id: 'replay', idempotent: true });
    changes = h.events.filter(e => e.type === h.JOBS_CHANGED_EVENT).length;
    await h.markJobSettled('replay', 'running');
    assert.equal(h.events.filter(e => e.type === h.JOBS_CHANGED_EVENT).length, changes + 1, 'clearing replay suppression is a real history change');
    await h.markJobSettled('replay', 'running');
    assert.equal(h.events.filter(e => e.type === h.JOBS_CHANGED_EVENT).length, changes + 1);
  } finally { delete globalThis.localStorage; delete globalThis.window; }
});
test('failed/refunded/cancelled, restored, idempotent and stale jobs never celebrate', async () => {
  const h=historyHarness();
  try {
    for(const state of ['failed','refunded','cancelled']) { h.pushJobHistory({job_id:state}); await h.markJobSettled(state,state); await h.markJobSettled(state,'succeeded'); }
    for(const entry of [{job_id:'restored',settled:'succeeded'},{job_id:'replay',idempotent:true},{job_id:'old',submitted_at:Date.now()-WATCH_MAX_AGE_MS}]) {h.pushJobHistory(entry);await h.markJobSettled(entry.job_id,'succeeded');}
    assert.equal(h.events.filter(e=>e.type===h.GENERATION_SUCCEEDED_EVENT).length,0);
  } finally {delete globalThis.localStorage;delete globalThis.window;}
});
test('celebration uses one live region, CSS reduced motion, and no success toast', () => {
  const read = path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  assert.match(read('app/veyrnox/veyrnox.css'), /prefers-reduced-motion: reduce[\s\S]*vx-celebrate-card[\s\S]*animation: none/);
  assert.doesNotMatch(read('app/veyrnox/_components/JobWatcher.js'), /toast.success/);
  assert.equal((read('app/veyrnox/_components/GenerationCelebration.js').match(/aria-live=/g)||[]).length,1);
});

import { createGenerationQueue } from '../app/veyrnox/_lib/generationQueue.mjs';
import { hookHarness } from './helpers/editorRoundHarness.mjs';
test('queue shows each unique result, coalesces bursts, and clears on account exit', () => {
  const shown=[], timers=new Map(); let serial=0;
  const q=createGenerationQueue({show:x=>shown.push(x),isPresent:id=>id!=='away',schedule:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;},cancel:id=>timers.delete(id)});
  q.push({job_id:'a',credits:2}); q.push({job_id:'a',credits:2});
  assert.equal(shown.length,1); assert.equal(timers.get(1).ms,2800);
  for(const id of ['b','c','d','away']) q.push({job_id:id,credits:1});
  timers.get(1).fn();
  assert.equal(shown[1].count,4);assert.equal(shown[1].credits,4);assert.equal(timers.get(2).ms,10000);
  q.clear(); assert.equal(shown.at(-1),null);assert.equal(timers.has(2),false);
});

test('queue retains only its latest 200 seen ids; shared settlement claims still handle older replays', () => {
  const shown = [];
  const q = createGenerationQueue({ show: value => shown.push(value), isPresent: () => true, schedule: () => 1, cancel() {} });
  for (let i = 0; i < 201; i++) { q.push({ job_id: String(i) }); q.dismiss(); }
  const count = shown.filter(Boolean).length;
  q.push({ job_id: '1' }); q.push({ job_id: '200' });
  assert.equal(shown.filter(Boolean).length, count, 'recent ids stay deduplicated');
  q.push({ job_id: '0' });
  assert.equal(shown.filter(Boolean).length, count + 1, 'oldest id was evicted');
  q.clear();
});

test('unknown swap times stay watchable, but only a pending-to-success observation celebrates', async () => {
  for (const time of [undefined, 0, -1]) for (const cached of [false, true]) for (const pendingFirst of [false, true]) {
    const h = historyHarness(), store = createSwapStore(), registrations = [], settlements = [];
    if (cached) h.storage.setItem('veyrnox_job_history_v2:A', JSON.stringify([{ job_id: 'restored', submitted_at: time }]));
    store.session('A');
    store.put({ accountId: 'A', templateId: 't', key: 'k', job_id: 'restored', state: 'running', body: { model_id: 'm' }, submitted_at: time });
    let reads = 0;
    const actions = createSwapActions(store, {
      gateway: async path => path === '/balance' ? {} : { job: { id: 'restored', state: pendingFirst && reads++ === 0 ? 'running' : 'succeeded', refunded: false, refund_state: 'none' } },
      wait: async () => {},
      jobStarted: entry => {
        registrations.push(entry); h.pushJobHistory(entry);
        assert.equal(h.jobsToWatch(h.readJobHistory()).length, 1);
      },
      jobSettled: (...args) => settlements.push(h.markJobSettled(...args)),
    });
    try {
      await actions.reconcile('t', 'k'); await Promise.all(settlements);
      assert.equal(Object.hasOwn(registrations[0], 'submitted_at'), false);
      assert.equal(registrations[0].recovering, false);
      assert.ok(h.readJobHistory()[0].submitted_at > 0);
      assert.equal(h.events.filter(e => e.type === h.GENERATION_SUCCEEDED_EVENT).length, pendingFirst ? 1 : 0);
      h.pushJobHistory({ job_id: 'invalid', submitted_at: time });
      assert.ok(h.readJobHistory().find(entry => entry.job_id === 'invalid').submitted_at > 0);
    } finally { delete globalThis.localStorage; delete globalThis.window; }
  }
});

test('a lost response followed by an idempotent retry stays watched, then celebrates a new completion', async () => {
  const history = historyHarness(), h = hookHarness();
  const previousDocument = globalThis.document;
  globalThis.document = { hidden: false };
  let state = 'running', reads = 0;
  const watcher = h.load('app/veyrnox/_components/JobWatcher.js', {
    '../../../components/I18nProvider': { useI18n: () => ({ t: key => key }) },
    '../../lib/authClient': { getStoredUserId: () => 'A' },
    '../_lib/jobHistory': history,
    '../_lib/gateway': { notifyBalanceChanged() {}, gatewayFetch: async () => { reads++; return { state }; } },
  });
  try {
    history.pushJobHistory({ job_id: 'lost', idempotent: true });
    assert.deepEqual(history.jobsToWatch(history.readJobHistory()).map(r => r.job_id), ['lost']);
    h.render(watcher.JobWatcher, {});
    await h.tick();
    assert.equal(history.readJobHistory()[0].settled, undefined);
    state = 'succeeded';
    await h.tick(); await h.tick();
    assert.equal(reads, 2);
    assert.equal(history.events.filter(e => e.type === history.GENERATION_SUCCEEDED_EVENT).length, 1);
    assert.equal(history.readJobHistory()[0].settled, 'succeeded');
  } finally { h.dispose(); globalThis.document = previousDocument; delete globalThis.localStorage; delete globalThis.window; }
});

test('an idempotent replay first read already settled is retired without a celebration', async () => {
  const h = historyHarness();
  try {
    h.pushJobHistory({ job_id: 'old-replay', idempotent: true });
    assert.equal(h.jobsToWatch(h.readJobHistory()).length, 1, 'allow a status read rather than hide it');
    assert.equal(await h.markJobSettled('old-replay', 'succeeded'), false);
    assert.equal(h.jobsToWatch(h.readJobHistory()).length, 0);
    h.pushJobHistory({ job_id: 'old-replay', idempotent: true });
    await h.markJobSettled('old-replay', 'succeeded');
    assert.equal(h.events.filter(e => e.type === h.GENERATION_SUCCEEDED_EVENT).length, 0);
  } finally { delete globalThis.localStorage; delete globalThis.window; }
});

test('a refunded failure stores failed and shows its refund toast exactly once', async () => {
  const history = historyHarness(), h = hookHarness(), toasts = [];
  const previousDocument = globalThis.document;
  globalThis.document = { hidden: false };
  const watcher = h.load('app/veyrnox/_components/JobWatcher.js', {
    '../../../components/I18nProvider': { useI18n: () => ({ t: key => key }) },
    '../../lib/authClient': { getStoredUserId: () => 'A' },
    '../_lib/jobHistory': history,
    'react-hot-toast': { __esModule: true, default: { error: (...args) => toasts.push(args) } },
    '../_lib/gateway': { notifyBalanceChanged() {}, gatewayFetch: async () => ({ state: 'failed', refunded: true, error_code: 'provider_error', credits: 5 }) },
  });
  try {
    history.pushJobHistory({ job_id: 'refund' });
    h.render(watcher.JobWatcher, {});
    await Promise.all([h.tick(), h.tick()]);
    await h.tick();
    assert.equal(history.readJobHistory()[0].settled, 'failed');
    assert.equal(JSON.parse(history.storage.getItem('veyrnox_job_history_v2:A'))[0].settled, 'failed');
    assert.deepEqual(toasts, [['public.jobs.refunded', { duration: 10000 }]]);
    assert.deepEqual(history.moodOptions, [{ code: 'provider_error', refunded: true }]);
    assert.equal(history.events.filter(e => e.type === history.GENERATION_SUCCEEDED_EVENT).length, 0);
    history.pushJobHistory({ job_id: 'not-refunded' });
    await history.markJobSettled('not-refunded', 'failed', 'provider_error', 5, false);
    assert.equal(history.moodOptions.at(-1).refunded, false, 'do not infer a refund from failure alone');
  } finally { h.dispose(); globalThis.document = previousDocument; delete globalThis.localStorage; delete globalThis.window; }
});

test('draft refund/cancellation cache values normalize to failed for every history reader', async () => {
  const h = historyHarness();
  try {
    h.storage.setItem('veyrnox_job_history_v2:A', JSON.stringify([{ job_id: 'old', settled: 'refunded' }, { job_id: 'cancel', settled: 'cancelled' }]));
    assert.deepEqual(h.readJobHistory().map(entry => entry.settled), ['failed', 'failed']);
    assert.equal(h.jobsToWatch(h.readJobHistory()).length, 0);
    h.pushJobHistory({ job_id: 'swap' });
    await h.markJobSettled('swap', 'refunded');
    assert.equal(h.readJobHistory()[0].settled, 'failed');
    assert.equal(h.moodOptions.at(-1).refunded, true);
    h.pushJobHistory({ job_id: 'restored', settled: 'cancelled' });
    const stored = JSON.parse(h.storage.getItem('veyrnox_job_history_v2:A'));
    assert.ok(stored.every(entry => entry.settled === 'failed'));
  } finally { delete globalThis.localStorage; delete globalThis.window; }
});

test('watcher retains unexpected terminal names until the public API confirms failure/refund', async () => {
  assert.deepEqual([...new Set(JOB_STATES.map(state => publicJob({ state }).state))].sort(), ['failed', 'queued', 'running', 'succeeded']);
  for (const unexpected of ['cancelled', 'refunded']) {
    const history = historyHarness(), h = hookHarness(), notices = [];
    const previousDocument = globalThis.document;
    globalThis.document = { hidden: false };
    let reply = { state: unexpected }, refreshed = 0;
    const { JobWatcher } = h.load('app/veyrnox/_components/JobWatcher.js', {
      '../../../components/I18nProvider': { useI18n: () => ({ t: key => key }) },
      '../../lib/authClient': { getStoredUserId: () => 'A' }, '../_lib/jobHistory': history,
      'react-hot-toast': { __esModule: true, default: { error: key => notices.push(key) } },
      '../_lib/gateway': { gatewayFetch: async () => reply, notifyBalanceChanged: () => { refreshed++; } },
    });
    try {
      history.pushJobHistory({ job_id: unexpected }); h.render(JobWatcher, {});
      await h.tick(); await h.tick();
      assert.equal(history.jobsToWatch(history.readJobHistory()).length, 1, 'an unsupported state must not silently retire the job');
      assert.equal(history.readJobHistory()[0].settled, undefined);
      reply = publicJob({ state: unexpected === 'refunded' ? 'REFUNDED' : 'FAILED', credits: 4 });
      await h.tick(); await h.tick();
      assert.equal(refreshed, 1);
      assert.deepEqual(notices, [unexpected === 'refunded' ? 'public.jobs.refunded' : 'public.jobs.pendingRefund']);
      assert.equal(history.readJobHistory()[0].settled, 'failed');
    } finally { h.dispose(); globalThis.document = previousDocument; delete globalThis.localStorage; delete globalThis.window; }
  }
});

test('own lost-response recovery may settle immediately, but a fresh old replay stays quiet', async () => {
  const h = historyHarness();
  try {
    h.pushJobHistory({ job_id: 'own-retry', idempotent: true, recovering: true });
    assert.equal(await h.markJobSettled('own-retry', 'succeeded'), true);
    h.pushJobHistory({ job_id: 'old-replay', idempotent: true, recovering: false });
    assert.equal(await h.markJobSettled('old-replay', 'succeeded'), false);
    assert.deepEqual(h.events.filter(e => e.type === h.GENERATION_SUCCEEDED_EVENT).map(e => e.detail.job_id), ['own-retry']);
  } finally { delete globalThis.localStorage; delete globalThis.window; }
});

test('staggered batch settlements do not abort or restart another id’s asset read', async () => {
  const h = hookHarness(), reads = new Map(), pending = new Map(), aborted = [];
  let tick = 0;
  const hook = h.load('app/veyrnox/_lib/useStudioJobs.js', {
    './resultPresence': { useResultPresence() {} },
    '../../lib/authClient': { getSession: () => ({ user: { id: 'A' } }), onSessionChange: () => () => {} },
    './jobHistory': { markJobSettled() {} },
    './gateway': { notifyBalanceChanged() {}, gatewayFetch: async (path, init) => {
      const id = path.split('/')[2];
      if (!path.endsWith('/asset')) return { state: Number(id) <= tick ? 'succeeded' : 'running' };
      reads.set(id, (reads.get(id) || 0) + 1);
      return new Promise((resolve, reject) => {
        pending.set(id, resolve);
        init.signal.addEventListener('abort', () => { aborted.push(id); reject(Object.assign(Error('aborted'), { name: 'AbortError' })); });
      });
    } },
  });
  const render = () => h.render(() => hook.useStudioJobs({}), {});
  try {
    let result = render();
    result.startJobs({ job_id: '1', state: 'running' });
    for (const id of ['2', '3', '4']) result.addJob({ job_id: id, state: 'running' });
    render();
    for (tick = 1; tick <= 4; tick++) { await h.tick(); result = render(); }
    assert.deepEqual(aborted, []);
    assert.deepEqual([...reads.values()], [1, 1, 1, 1]);
    for (const id of ['4', '3', '2', '1']) {
      pending.get(id)({ url: `https://fresh.invalid/${id}`, mime_type: 'video/mp4' });
      await new Promise(resolve => setImmediate(resolve)); result = render();
      assert.deepEqual(aborted, []);
    }
    assert.ok(result.jobs.every(job => job.asset_url && !job.asset_error && !job.asset_loading));
    assert.deepEqual([...reads.values()], [1, 1, 1, 1]);
  } finally { h.dispose(); }
});

test('AbortError does not consume the asset failure budget', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = hookHarness(); let reads = 0;
  const hook = h.load('app/veyrnox/_lib/useStudioJobs.js', {
    './resultPresence': { useResultPresence() {} },
    '../../lib/authClient': { getSession: () => ({ user: { id: 'A' } }), onSessionChange: () => () => {} },
    './jobHistory': { markJobSettled() {} },
    './gateway': { gatewayFetch: async () => {
      reads++;
      if (reads <= 3) throw Object.assign(Error('aborted'), { name: 'AbortError' });
      if (reads <= 5) throw Error('offline');
      return { url: 'https://fresh.invalid', mime_type: 'image/png' };
    } },
  });
  const render = () => h.render(() => hook.useStudioJobs({}), {});
  try {
    render().startJobs({ job_id: 'j', state: 'succeeded' }); render();
    await new Promise(resolve => setImmediate(resolve));
    for (let step = 0; step < 5; step++) {
      t.mock.timers.tick(2000); await new Promise(resolve => setImmediate(resolve)); render();
    }
    assert.equal(reads, 6);
    assert.equal(render().jobs[0].asset_url, 'https://fresh.invalid');
    assert.ok(!render().jobs[0].asset_error);
  } finally { h.dispose(); }
});

test('route dismissal keeps queued results and their deduplication claims', () => {
  const shown = [], timers = new Map(); let serial = 0;
  const q = createGenerationQueue({ show: item => shown.push(item), isPresent: () => false,
    schedule: (fn, ms) => { timers.set(++serial, { fn, ms }); return serial; }, cancel: id => timers.delete(id) });
  q.push({ job_id: 'visible' }); q.push({ job_id: 'queued' }); q.push({ job_id: 'last' });
  q.dismiss();
  assert.equal(timers.has(1), false);
  assert.deepEqual(shown.map(item => item?.job_id), ['visible', 'queued']);
  q.push({ job_id: 'visible' }); q.push({ job_id: 'queued' });
  q.dismiss(); q.dismiss();
  assert.deepEqual(shown.map(item => item?.job_id), ['visible', 'queued', 'last', undefined]);
  q.clear();
});

test('celebration listener survives navigation and uses localized credits without reserving a layout row', () => {
  const listeners = new Map(), seen = [];
  const browser = { addEventListener: (type, fn) => { seen.push(type); listeners.set(type, fn); }, removeEventListener: type => listeners.delete(type) };
  const h = hookHarness({ browser }); let pathname = '/app/create';
  const component = h.load('app/veyrnox/_components/GenerationCelebration.js', {
    'next/navigation': { usePathname: () => pathname }, 'next/link': 'a',
    '../../../components/I18nProvider': { useI18n: () => ({ t: (key, args) => key === 'pricing.cards.credits' ? `${args.credits} crédits` : key }) },
    '../../lib/authClient': { getSession: () => ({ user: { id: 'A' } }), onSessionChange: () => () => {} },
    '../_lib/jobHistory': { GENERATION_SUCCEEDED_EVENT: 'success' },
    '../_lib/generationQueue.mjs': { createGenerationQueue }, '../_lib/resultPresence': { resultIsPresent: () => true },
    '../_lib/celebrationSound': { playCelebrationSound() {} }, './ConfettiBurst': { ConfettiBurst: () => null },
    './VeyCharacter': { default: () => null }, 'motion/react': { useReducedMotion: () => true },
  });
  const render = () => h.render(component.GenerationCelebration, {});
  try {
    render();
    listeners.get('success')({ detail: { job_id: 'a', credits: 3 } });
    listeners.get('success')({ detail: { job_id: 'b', credits: 5 } });
    render(); pathname = '/app/library'; render(); const tree = render();
    assert.deepEqual(seen, ['success']);
    assert.equal(tree.props.children.key, 'b');
    assert.match(JSON.stringify(tree), /5 crédits/);
    assert.doesNotMatch(JSON.stringify(tree), /5 cr"/);
    const css = readFileSync(new URL('../app/veyrnox/veyrnox.css', import.meta.url), 'utf8');
    assert.match(css, /\.vx-generation-notice \{[^}]*pointer-events: none;[^}]*position: fixed/);
    assert.match(css, /top: calc\(env\(safe-area-inset-top, 0px\) \+ 72px\)/);
    assert.match(css, /@media \(max-width: 639px\)[\s\S]*\.vx-generation-notice \{ width: auto; max-width: none; inset-inline: 16px;/);
    assert.match(css, /\.vx-celebrate-card \{ flex-wrap: nowrap;[^}]*padding: 4px 12px;/);
    assert.match(css, /\.vx-celebrate-link \{ flex: none; padding: 0 8px; white-space: nowrap;/);
    assert.match(css, /\.vx-celebrate-link \{[^}]*pointer-events: auto/);
    assert.doesNotMatch(css, /--vx-generation-notice-height|\.vx-generation-notice:has/);
    const source = readFileSync(new URL('../app/veyrnox/_components/GenerationCelebration.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /useLayoutEffect|ResizeObserver|getBoundingClientRect|style\.setProperty/);
  } finally { h.dispose(); }
  assert.equal(listeners.size, 0);
});
test('asset retries remain separate from terminal state and recover on explicit retry', async () => {
  const h=hookHarness(), settled=[];let assetReads=0, recovered=false;
  const hook=h.load('app/veyrnox/_lib/useStudioJobs.js',{
    './resultPresence':{useResultPresence(){}},
    '../../lib/authClient':{getSession:()=>({user:{id:'A'}}),onSessionChange:()=>()=>{}},
    './jobHistory':{markJobSettled:(...args)=>settled.push(args)},
    './gateway':{notifyBalanceChanged(){},gatewayFetch:async path=>{
      if(!path.endsWith('/asset'))return {state:'succeeded',credits:3};
      assetReads++;if(!recovered)throw Error('offline');return {url:'https://fresh.invalid',mime_type:'video/mp4'};
    }},
  });
  const render=()=>h.render(()=>hook.useStudioJobs({}),{});
  try {
    let state=render();state.startJobs({job_id:'j',state:'running'});render();await h.tick();render();
    await new Promise(resolve=>setTimeout(resolve,3100));state=render();
    assert.equal(state.jobs[0].state,'succeeded');assert.equal(state.jobs[0].asset_error,true);assert.equal(assetReads,3);assert.equal(settled.length,1);
    recovered=true;state.jobs[0].retryAsset();render();await new Promise(resolve=>setImmediate(resolve));state=render();
    assert.equal(state.jobs[0].asset_url,'https://fresh.invalid');assert.equal(state.jobs[0].asset_error,false);assert.equal(settled.length,1);
  } finally {h.dispose();}
});

test('studio polling also retains unexpected state names instead of retiring history', async () => {
  const h = hookHarness(), settled = [];
  let state = 'cancelled', balanceReads = 0;
  const { useStudioJobs } = h.load('app/veyrnox/_lib/useStudioJobs.js', {
    './resultPresence': { useResultPresence() {} },
    '../../lib/authClient': { getSession: () => ({ user: { id: 'A' } }), onSessionChange: () => () => {} },
    './jobHistory': { markJobSettled: (...args) => settled.push(args) },
    './gateway': { gatewayFetch: async () => ({ state, refunded: true }), notifyBalanceChanged: () => { balanceReads++; } },
  });
  const render = () => h.render(() => useStudioJobs({}), {});
  try {
    render().startJobs({ job_id: 'j', state: 'queued' }); render();
    await h.tick(); assert.equal(render().jobs[0].state, 'queued');
    state = 'refunded'; await h.tick(); assert.equal(render().jobs[0].state, 'queued');
    assert.deepEqual(settled, []);
    state = 'failed'; await h.tick(); assert.equal(render().jobs[0].state, 'failed');
    assert.equal(settled.length, 1); assert.equal(balanceReads, 1);
  } finally { h.dispose(); }
});
