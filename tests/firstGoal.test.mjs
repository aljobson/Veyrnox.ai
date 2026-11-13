import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRST_GOALS,
  FIRST_GOAL_EXAMPLES,
  FIRST_GOAL_SLOT,
  firstGoalTarget,
  parseFirstGoal,
  readRemoteFirstGoal,
  serializeFirstGoal,
} from '../app/veyrnox/_lib/firstGoal.js';

test('first-goal choices cover every creation area plus "not sure"', () => {
  assert.deepEqual(FIRST_GOALS.map(({ id }) => id), ['image', 'video', 'audio', 'edit', 'publish', 'unsure']);
});

test('creation goals stay on Create with the matching model filter; others route away', () => {
  assert.deepEqual(firstGoalTarget('image'), { createGoal: 'image', href: null });
  assert.deepEqual(firstGoalTarget('video'), { createGoal: 'video', href: null });
  assert.deepEqual(firstGoalTarget('audio'), { createGoal: 'audio', href: null });
  assert.deepEqual(firstGoalTarget('unsure'), { createGoal: 'all', href: null });
  assert.deepEqual(firstGoalTarget('edit'), { createGoal: null, href: '/app/editor' });
  assert.deepEqual(firstGoalTarget('publish'), { createGoal: null, href: '/app/publish' });
  assert.deepEqual(firstGoalTarget('nonsense'), { createGoal: 'all', href: null });
});

test('the stored choice is versioned and anything unreadable reads as "never chose"', () => {
  assert.equal(FIRST_GOAL_SLOT, 'veyrnox.firstGoal.v1');
  assert.deepEqual(parseFirstGoal(serializeFirstGoal('audio')), { version: 1, goal: 'audio' });
  assert.deepEqual(parseFirstGoal(serializeFirstGoal('skipped')), { version: 1, goal: 'skipped' });
  for (const bad of [null, undefined, '', '{', '[]', '{"version":2,"goal":"audio"}', '{"version":1,"goal":"rm -rf"}', '{"version":1}']) {
    assert.equal(parseFirstGoal(bad), null, String(bad));
  }
});

test('serialising an unknown goal is refused instead of storing it', () => {
  assert.throws(() => serializeFirstGoal('rm -rf'), /unknown first goal/);
});

test('"not sure" offers one example for each creation area, in the same order as the goals', () => {
  assert.deepEqual(FIRST_GOAL_EXAMPLES, ['image', 'video', 'audio']);
  for (const goal of FIRST_GOAL_EXAMPLES) assert.equal(firstGoalTarget(goal).href, null);
});

test('the server reply is read strictly: a listed word, none yet, or unavailable', () => {
  for (const goal of [...FIRST_GOALS.map(({ id }) => id), 'skipped']) assert.deepEqual(readRemoteFirstGoal({ goal }), { kind: 'goal', goal });
  assert.deepEqual(readRemoteFirstGoal({ goal: null }), { kind: 'none' });
  for (const bad of [null, undefined, 'image', [], {}, { goal: 7 }, { goal: 'rm -rf' }, { goal: ['image'] }]) {
    assert.deepEqual(readRemoteFirstGoal(bad), { kind: 'unavailable' }, JSON.stringify(bad));
  }
});

test('web sync: signed out asks nothing; failures read as unavailable; a push is best effort', async () => {
  const { fetchRemoteFirstGoal, pushFirstGoal } = await import('../app/veyrnox/_lib/firstGoalSync.js');
  const calls = [];
  const fetcher = async (path, init) => { calls.push([path, init?.method || 'GET', init?.body]); return { goal: 'video' }; };
  assert.deepEqual(await fetchRemoteFirstGoal(fetcher, () => null), { kind: 'unavailable' });
  await pushFirstGoal('image', fetcher, () => null);
  assert.deepEqual(calls, [], 'signed out: no request at all');
  assert.deepEqual(await fetchRemoteFirstGoal(fetcher, () => ({})), { kind: 'goal', goal: 'video' });
  await pushFirstGoal('image', fetcher, () => ({}));
  assert.deepEqual(calls, [['/first-goal', 'GET', undefined], ['/first-goal', 'PUT', '{"goal":"image"}']]);
  const down = async () => { throw Object.assign(new Error('x'), { status: 404 }); };
  assert.deepEqual(await fetchRemoteFirstGoal(down, () => ({})), { kind: 'unavailable' });
  await pushFirstGoal('image', down, () => ({})); // never throws
});

test('a home start option is the answer: Film is video, Smart Cut is edit, Create and Chat name no area', async () => {
  const { HOME_START_GOALS, homeStartGoal } = await import('../app/veyrnox/_lib/firstGoal.js');
  assert.deepEqual(HOME_START_GOALS, { create: 'skipped', chat: 'skipped', film: 'video', 'smart-cut': 'edit' });
  assert.equal(homeStartGoal('film'), 'video');
  assert.equal(homeStartGoal('nonsense'), null);
  for (const goal of Object.values(HOME_START_GOALS)) assert.doesNotThrow(() => serializeFirstGoal(goal));
});

test('web: a home tap stores the goal once, pushes it, and never replaces an answer already held', async () => {
  const sync = await import('../app/veyrnox/_lib/firstGoalSync.js');
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const calls = [];
  const fetcher = async (path, init) => { calls.push([path, init?.method, init?.body]); return {}; };
  assert.equal(sync.homeStartRecorded(), false);
  await sync.recordHomeStart('smart-cut', { storage, fetcher, session: () => ({}) });
  assert.equal(store.get('veyrnox.firstGoal.v1'), '{"version":1,"goal":"edit"}');
  assert.deepEqual(calls, [['/first-goal', 'PUT', '{"goal":"edit"}']]);
  assert.equal(sync.homeStartRecorded(), true, 'the Create page treats this visit as answered even before the server replies');
  await sync.recordHomeStart('create', { storage, fetcher, session: () => ({}) });
  assert.equal(store.get('veyrnox.firstGoal.v1'), '{"version":1,"goal":"edit"}', 'a held answer stays');
  assert.equal(calls.length, 1);
  await sync.recordHomeStart('unknown', { storage, fetcher, session: () => ({}) });
  assert.equal(calls.length, 1);
});

test('the home page records the start option and Create no longer asks after it', async () => {
  const { readFile } = await import('node:fs/promises');
  const home = await readFile(new URL('../app/veyrnox/app/page.js', import.meta.url), 'utf8');
  assert.match(home, /recordHomeStart\(icon\)/);
  const card = await readFile(new URL('../app/veyrnox/_components/FirstGoalCard.js', import.meta.url), 'utf8');
  assert.match(card, /homeStartRecorded\(\)/);
});
