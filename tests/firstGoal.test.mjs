import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRST_GOALS,
  FIRST_GOAL_EXAMPLES,
  FIRST_GOAL_SLOT,
  firstGoalTarget,
  parseFirstGoal,
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
