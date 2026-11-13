import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FIRST_ROLES, FIRST_DESTINATIONS, FIRST_PROFILE_SLOT, parseFirstProfile, serializeFirstProfile, readRemoteFirstProfile,
    needsFirstRun, orderStarts, exampleSetFor, defaultAspectFor, hasRealAnswer,
} from '../app/veyrnox/_lib/firstProfile.js';
import { FIRST_ROLE_VALUES, FIRST_DESTINATION_VALUES, cleanFirstAnswers } from '../lib/firstGoal.js';

const STARTS = ['create', 'chat', 'film', 'smart-cut'];

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

test('the flow is for someone with no goal and no role on record', () => {
    assert.equal(needsFirstRun({ goal: null, role: null }), true);
    assert.equal(needsFirstRun({ goal: 'skipped', role: null }), false, 'a home start option already answered');
    assert.equal(needsFirstRun({ goal: null, role: 'skipped' }), false);
    assert.equal(needsFirstRun({ goal: 'video', role: 'creator' }), false);
});

test('home start options: every role keeps all four, once, and a real goal moves its area first', () => {
    for (const role of [...FIRST_ROLES, 'skipped', null]) {
        for (const goal of [null, 'image', 'video', 'audio', 'edit', 'publish', 'unsure', 'skipped']) {
            assert.deepEqual([...orderStarts(role, goal)].sort(), [...STARTS].sort(), `${role}/${goal}`);
        }
    }
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
  const { readDeviceAnswers, saveDeviceAnswers } = await import('../app/veyrnox/_lib/firstProfileSync.js');
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
  } finally { delete globalThis.window; }
});
