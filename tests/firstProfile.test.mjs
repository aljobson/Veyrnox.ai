import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    FIRST_ROLES, FIRST_DESTINATIONS, FIRST_PROFILE_SLOT, parseFirstProfile, serializeFirstProfile, readRemoteFirstProfile,
    parseFirstOnboarding, serializeFirstOnboarding, readRemoteFirstOnboarding,
    needsFirstRun, onboardingUiComplete, orderStarts, exampleSetFor, defaultAspectFor, hasRealAnswer,
} from '../app/veyrnox/_lib/firstProfile.js';
import { FIRST_ROLE_VALUES, FIRST_DESTINATION_VALUES, cleanFirstAnswers } from '../lib/firstGoal.js';

const STARTS = ['create', 'audio', 'chat', 'film', 'smart-cut'];

test('the lists are the words the database accepts, plus "skipped"', () => {
    assert.deepEqual([...FIRST_ROLE_VALUES], [...FIRST_ROLES, 'skipped']);
    assert.deepEqual([...FIRST_DESTINATION_VALUES], [...FIRST_DESTINATIONS, 'skipped']);
    assert.deepEqual([...FIRST_ROLES], ['creator', 'business', 'pro', 'hobbyist', 'beginner']);
    assert.deepEqual([...FIRST_DESTINATIONS], ['tiktok', 'reels', 'youtube', 'private']);
});

test('the device copy round-trips and anything unreadable reads as "never chose"', () => {
    assert.equal(FIRST_PROFILE_SLOT, 'veyrnox.firstProfile.v1');
    const raw = serializeFirstProfile({ role: 'creator', destination: 'skipped' });
    assert.deepEqual(parseFirstProfile(raw), { role: 'creator', destination: 'skipped' });
    assert.deepEqual(parseFirstProfile(serializeFirstProfile({ role: 'creator' })), { role: 'creator', destination: null });
    for (const bad of [null, '', 'x', '[]', '{"version":2,"role":"creator"}', '{"version":1,"role":"CEO","destination":"mars"}']) {
        assert.deepEqual(parseFirstProfile(bad), { role: null, destination: null }, String(bad));
    }
    assert.throws(() => serializeFirstProfile({ role: 'CEO' }));
});

test('the server body is read as role and destination, or unavailable', () => {
    assert.deepEqual(readRemoteFirstProfile({ goal: 'image', role: 'pro', destination: 'reels' }), { kind: 'profile', role: 'pro', destination: 'reels' });
    assert.deepEqual(readRemoteFirstProfile({ goal: null, role: null, destination: null }), { kind: 'profile', role: null, destination: null });
    assert.deepEqual(readRemoteFirstProfile({ goal: null }), { kind: 'profile', role: null, destination: null }, 'an older server that sends no role means none');
    assert.deepEqual(readRemoteFirstProfile({ role: 'astronaut' }), { kind: 'unavailable' });
    assert.deepEqual(readRemoteFirstProfile(null), { kind: 'unavailable' });
});

test('progress is strict and the device envelope is fenced to one account owner', () => {
    assert.deepEqual(readRemoteFirstOnboarding({ version: 1, current_step: 'destination', completed: false }),
        { kind: 'progress', version: 1, currentStep: 'destination', completed: false });
    assert.deepEqual(readRemoteFirstOnboarding({ version: 0, current_step: null, completed: true }),
        { kind: 'progress', version: 0, currentStep: null, completed: true });
    for (const bad of [{ version: 1, current_step: null, completed: false }, { version: 1, current_step: 'goal', completed: true }, { version: 2, current_step: 'goal', completed: false }]) {
        assert.deepEqual(readRemoteFirstOnboarding(bad), { kind: 'unavailable' });
    }
    const raw = serializeFirstOnboarding('alice', { goal: 'video', role: null, destination: null, version: 1, currentStep: 'destination', completed: false });
    assert.deepEqual(parseFirstOnboarding(raw, 'alice'), { goal: 'video', role: null, destination: null, version: 1, currentStep: 'destination', completed: false });
    assert.equal(parseFirstOnboarding(raw, 'bob'), null);
    const pending = serializeFirstOnboarding('alice', { goal: 'video', role: 'creator', destination: 'youtube', version: 1,
      currentStep: 'recap', completed: false, pending: true, completeRequested: true });
    assert.deepEqual(parseFirstOnboarding(pending, 'alice'), { goal: 'video', role: 'creator', destination: 'youtube', version: 1,
      currentStep: 'recap', completed: false, pending: true, completeRequested: true });
});

test('the flow is for someone with no goal and no role on record', () => {
    assert.equal(needsFirstRun({ goal: null, role: null }), true);
    assert.equal(needsFirstRun({ goal: 'skipped', role: null }), false, 'a home start option already answered');
    assert.equal(needsFirstRun({ goal: null, role: 'skipped' }), false);
    assert.equal(needsFirstRun({ goal: 'video', role: 'creator' }), false);
    assert.equal(needsFirstRun({ goal: 'video', role: null, completed: false }), true, 'account progress outranks the old heuristic');
    assert.equal(needsFirstRun({ goal: null, role: null, completed: true }), false, 'grandfathered legacy accounts stay complete');
});

test('a persisted completion request closes the UI while its truthful pending outbox keeps replaying', () => {
    assert.equal(onboardingUiComplete({ completed: false, pending: true, completeRequested: true }), true);
    assert.equal(onboardingUiComplete({ completed: false, pending: true, completeRequested: false }), false);
    assert.equal(onboardingUiComplete({ completed: false, completeRequested: true }), false);
    assert.equal(onboardingUiComplete({ completed: true }), true);
});

test('migration 0578 materialises only established, non-deleted no-row accounts as version-0 complete', async () => {
    const sql = await readFile(new URL('../packages/db/schema/supabase/0578_first_run_progress.sql', import.meta.url), 'utf8');
    assert.match(sql, /INSERT INTO public\.first_goals[\s\S]*SELECT u\.id, NULL, NULL, NULL, 0, NULL, true/);
    assert.match(sql, /u\.deleted_at IS NULL/);
    assert.match(sql, /NOT EXISTS \(SELECT 1 FROM public\.first_goals g WHERE g\.user_id = u\.id\)/);
    assert.match(sql, /ON CONFLICT \(user_id\) DO NOTHING/);
    assert.ok(sql.indexOf('INSERT INTO public.first_goals') < sql.indexOf('CREATE OR REPLACE FUNCTION public.get_first_answers'),
        'the one-time cohort materialisation precedes the read RPC');
});

test('home start options: every role keeps all four, once, and a real goal moves its area first', () => {
    for (const role of [...FIRST_ROLES, 'skipped', null]) {
        for (const goal of [null, 'image', 'video', 'audio', 'edit', 'publish', 'unsure', 'skipped']) {
            assert.deepEqual([...orderStarts(role, goal)].sort(), [...STARTS].sort(), `${role}/${goal}`);
        }
    }
    for (const role of [...FIRST_ROLES, null]) assert.equal(orderStarts(role, 'audio')[0], 'audio');
    assert.deepEqual(orderStarts(null, null), STARTS, 'no answer keeps today\'s order');
    assert.equal(orderStarts('creator', null)[0], 'create');
    assert.equal(orderStarts('pro', null)[0], 'film');
    assert.equal(orderStarts('creator', 'edit')[0], 'smart-cut');
    assert.equal(orderStarts('hobbyist', 'video')[0], 'film');
    assert.equal(orderStarts('beginner', 'unsure')[0], 'create');
});

test('example prompts: work for creator, business and pro; everyday otherwise', () => {
    for (const role of ['creator', 'business', 'pro']) assert.equal(exampleSetFor(role), 'work');
    for (const role of ['hobbyist', 'beginner', 'skipped', null, 'x']) assert.equal(exampleSetFor(role), 'everyday');
});

test('destination sets the starting aspect ratio, and "just for me" changes nothing', () => {
    assert.equal(defaultAspectFor('tiktok'), '9:16');
    assert.equal(defaultAspectFor('reels'), '9:16');
    assert.equal(defaultAspectFor('youtube'), '16:9');
    for (const none of ['private', 'skipped', null, undefined, 'mars']) assert.equal(defaultAspectFor(none), null);
});

test('only a real word counts as an answer to show "Suggested for you"', () => {
    assert.equal(hasRealAnswer({ role: 'creator' }), true);
    assert.equal(hasRealAnswer({ role: 'skipped', destination: 'skipped' }), false);
    assert.equal(hasRealAnswer({ role: null, destination: 'youtube' }), true);
    assert.equal(hasRealAnswer({ goal: 'edit' }), true);
    assert.equal(hasRealAnswer({ goal: 'unsure', role: null }), false);
    assert.equal(hasRealAnswer(null), false);
});

test('the PUT body is any non-empty subset of goal, role, destination, every word listed', () => {
    assert.deepEqual(cleanFirstAnswers({ role: 'creator' }), { ok: true, answers: { role: 'creator' } });
    assert.deepEqual(cleanFirstAnswers({ goal: 'video', role: 'pro', destination: 'private' }), { ok: true, answers: { goal: 'video', role: 'pro', destination: 'private' } });
    assert.deepEqual(cleanFirstAnswers({ destination: 'skipped' }), { ok: true, answers: { destination: 'skipped' } });
    assert.deepEqual(cleanFirstAnswers({}), { ok: false, field: 'goal' });
    assert.deepEqual(cleanFirstAnswers({ role: 'CEO' }), { ok: false, field: 'role' });
    assert.deepEqual(cleanFirstAnswers({ destination: 'mars' }), { ok: false, field: 'destination' });
    assert.deepEqual(cleanFirstAnswers({ goal: 'nope', role: 'pro' }), { ok: false, field: 'goal' });
    assert.deepEqual(cleanFirstAnswers({ role: 'pro', extra: 1 }), { ok: false, field: 'goal' });
    for (const bad of [null, [], 'role', 7]) assert.equal(cleanFirstAnswers(bad).ok, false);
    assert.equal(cleanFirstAnswers({ role: 7 }).ok, false);
});

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

test('web device copy: saves each word, never lowers a real one to "skipped", reads goal, role and destination together', async () => {
  const { readDeviceAnswers, readOfflineOnboarding, saveDeviceAnswers, saveDeviceOnboarding } = await import('../app/veyrnox/_lib/firstProfileSync.js');
  const slot = memory();
  assert.deepEqual(readDeviceAnswers(slot), { goal: null, role: null, destination: null });
  assert.deepEqual(saveDeviceAnswers({ role: 'creator' }, slot), { goal: null, role: 'creator', destination: null });
  assert.deepEqual(saveDeviceAnswers({ goal: 'video', destination: 'reels' }, slot), { goal: 'video', role: 'creator', destination: 'reels' });
  assert.deepEqual(saveDeviceAnswers({ role: 'skipped', destination: 'skipped', goal: 'skipped' }, slot), { goal: 'video', role: 'creator', destination: 'reels' });
  assert.deepEqual(saveDeviceAnswers({ role: 'pro' }, slot), { goal: 'video', role: 'pro', destination: 'reels' }, 'one real word may replace another');
  assert.deepEqual(readDeviceAnswers(slot), { goal: 'video', role: 'pro', destination: 'reels' });
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(readDeviceAnswers(blocked), { goal: null, role: null, destination: null });
  assert.doesNotThrow(() => saveDeviceAnswers({ role: 'pro' }, blocked));
  saveDeviceOnboarding('alice', { goal: 'video', role: null, destination: null, version: 1, currentStep: 'destination', completed: false }, slot);
  assert.deepEqual(readOfflineOnboarding('alice', slot), { kind: 'answers', goal: 'video', role: null, destination: null, version: 1, currentStep: 'destination', completed: false });
  assert.deepEqual(readOfflineOnboarding('bob', slot), { kind: 'unresolved' }, 'another account never inherits Alice\'s progress or completion');
  assert.deepEqual(readOfflineOnboarding(null, slot), { kind: 'signed-out' });
});

test('web sync: signed out asks nothing; the account\'s answers are read whole; a push sends only listed words', async () => {
  const { fetchRemoteAnswers, pushAnswers } = await import('../app/veyrnox/_lib/firstProfileSync.js');
  const calls = [];
  const fetcher = async (path, init) => { calls.push([path, init?.method || 'GET', init?.body]); return { goal: 'edit', role: 'business', destination: null }; };
  assert.deepEqual(await fetchRemoteAnswers(fetcher, () => null), { kind: 'unavailable' });
  await pushAnswers({ role: 'pro' }, fetcher, () => null);
  assert.deepEqual(calls, [], 'signed out: no request at all');
  assert.deepEqual(await fetchRemoteAnswers(fetcher, () => ({})), { kind: 'answers', goal: 'edit', role: 'business', destination: null });
  await pushAnswers({ role: 'pro', destination: 'youtube', extra: 'x', goal: 7 }, fetcher, () => ({}));
  await pushAnswers({}, fetcher, () => ({}));
  assert.deepEqual(calls, [['/first-goal', 'GET', undefined], ['/first-goal', 'PUT', '{"role":"pro","destination":"youtube"}']]);
  const old = async () => ({ goal: null }); // a server from before 0499 sends no role
  assert.deepEqual(await fetchRemoteAnswers(old, () => ({})), { kind: 'answers', goal: null, role: null, destination: null });
  const down = async () => { throw Object.assign(new Error('x'), { status: 404 }); };
  assert.deepEqual(await fetchRemoteAnswers(down, () => ({})), { kind: 'unavailable' });
  await pushAnswers({ role: 'pro' }, down, () => ({}));
  const odd = async () => ({ goal: 'image', role: 'astronaut' });
  assert.deepEqual(await fetchRemoteAnswers(odd, () => ({})), { kind: 'unavailable' });
});

test('web hand-off: one creation goal, once, in this tab only', async () => {
  const { setFirstRunHandoff, takeFirstRunHandoff } = await import('../app/veyrnox/_lib/firstProfileSync.js');
  const store = memory();
  globalThis.window = { sessionStorage: store };
  try {
    assert.equal(takeFirstRunHandoff(), null);
    setFirstRunHandoff('video');
    assert.equal(takeFirstRunHandoff(), 'video');
    assert.equal(takeFirstRunHandoff(), null, 'taken once');
    setFirstRunHandoff('edit');
    assert.equal(takeFirstRunHandoff(), null, 'only creation goals are handed over');
    setFirstRunHandoff('audio');
    assert.equal(takeFirstRunHandoff(), null, 'audio opens its dedicated workspace instead of Create');
  } finally { delete globalThis.window; }
});

test('web sync asks with the stored session, so an expired access token (refreshed by the gateway) never reads as "no account"', async () => {
  const src = await readFile(new URL('../app/veyrnox/_lib/firstProfileSync.js', import.meta.url), 'utf8');
  assert.match(src, /session = getStoredSession\)/);
  assert.ok(!/getSession\b/.test(src.replace(/getStoredSession/g, '')), 'no call asks for the live token session');
});

test('web outbox remains incomplete on failure, reconciles 409, and replays canonically after relaunch', async () => {
  const { replayOnboarding, readDeviceOnboarding, saveDeviceOnboarding } = await import('../app/veyrnox/_lib/firstProfileSync.js');
  const storage = memory();
  const desired = { goal: 'video', destination: 'youtube', role: 'creator', version: 1, currentStep: 'recap',
    completed: false, pending: true, completeRequested: true };
  const down = async (path, init) => {
    if (init?.method === 'PUT') throw new Error('offline');
    return { goal: null, destination: null, role: null, version: 1, current_step: 'goal', completed: false };
  };
  const failed = await replayOnboarding('alice', desired, { fetcher: down, currentOwner: () => 'alice', storage, timeoutMs: 50 });
  assert.equal(failed.completed, false);
  assert.equal(failed.pending, true);
  assert.equal(readDeviceOnboarding('alice', storage).completed, false, 'failure never fabricates local completion');

  const order = [];
  const success = async (path, init) => {
    if (!init?.method) return { goal: 'video', destination: 'youtube', role: 'creator', version: 1, current_step: null, completed: true };
    const body = JSON.parse(init.body); order.push(body.current_step);
    return { goal: 'video', destination: 'youtube', role: 'creator', version: 1,
      current_step: body.current_step === 'recap' ? null : 'recap', completed: body.current_step === 'recap' };
  };
  const settled = await replayOnboarding('alice', readDeviceOnboarding('alice', storage), { fetcher: success, currentOwner: () => 'alice', storage, timeoutMs: 100 });
  assert.deepEqual(order, ['goal', 'destination', 'role', 'recap']);
  assert.equal(settled.completed, true);
  assert.equal(settled.pending, false);

  const conflictCalls = [];
  const conflict = async (path, init) => {
    if (!init?.method) return { goal: 'video', destination: 'youtube', role: 'creator', version: 1, current_step: 'recap', completed: false };
    const body = JSON.parse(init.body); conflictCalls.push(body.current_step);
    if (body.current_step === 'recap') throw Object.assign(new Error('incomplete'), { status: 409 });
    return { goal: 'video', destination: 'youtube', role: 'creator', version: 1, current_step: 'recap', completed: false };
  };
  const pending = await replayOnboarding('alice', desired, { fetcher: conflict, currentOwner: () => 'alice', storage, timeoutMs: 100 });
  assert.deepEqual(conflictCalls, ['goal', 'destination', 'role', 'recap']);
  assert.equal(pending.currentStep, 'recap');
  assert.equal(pending.pending, true);

  const first = { ...desired, destination: 'tiktok', currentStep: 'role', completeRequested: false };
  saveDeviceOnboarding('alice', first, storage);
  let advanced = false;
  const superseded = async (path, init) => {
    if (!advanced && init?.method === 'PUT') {
      advanced = true;
      saveDeviceOnboarding('alice', desired, storage);
    }
    return init?.method
      ? { goal: 'video', destination: 'tiktok', role: 'creator', version: 1, current_step: 'recap', completed: false }
      : { goal: 'video', destination: 'tiktok', role: 'creator', version: 1, current_step: 'recap', completed: false };
  };
  const newest = await replayOnboarding('alice', first, { fetcher: superseded, currentOwner: () => 'alice', storage, timeoutMs: 100 });
  assert.equal(newest.destination, 'youtube');
  assert.equal(newest.completeRequested, true, 'an older acknowledgement never erases a newer durable envelope');
});

test('web Escape dismissal belongs to one owner for this tab session', async () => {
  const { dismissFirstRun, isFirstRunDismissed } = await import('../app/veyrnox/_lib/firstProfileSync.js');
  const storage = memory();
  dismissFirstRun('alice', storage);
  assert.equal(isFirstRunDismissed('alice', storage), true);
  assert.equal(isFirstRunDismissed('bob', storage), false);
});
