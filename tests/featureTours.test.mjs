import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_TOURS, tourForPath, parseSeen, addSeen } from '../lib/featureTours.js';
import { HELP_TARGETS } from '../lib/productHelp.js';

test('every tour has unique id, absolute route and at least one required-or-sole step', () => {
  const ids = new Set();
  for (const tour of FEATURE_TOURS) {
    assert.ok(!ids.has(tour.id), tour.id); ids.add(tour.id);
    assert.match(tour.route, /^\/app/);
    assert.ok(tour.steps.length > 0);
    for (const step of tour.steps) assert.ok(step.selector && step.title && step.message, tour.id);
  }
});

test('data-assistant-target selectors name real helper targets', () => {
  for (const tour of FEATURE_TOURS) for (const step of tour.steps) {
    const m = step.selector.match(/data-assistant-target="([^"]+)"/);
    if (m) assert.ok(HELP_TARGETS[m[1]] || /^(chat|library|publish|enhance|credits|film|oddlings|create)\./.test(m[1]), `${tour.id}: ${m[1]}`);
  }
});

test('routes resolve to the most specific tour', () => {
  assert.equal(tourForPath('/app').id, 'explore');
  assert.equal(tourForPath('/app/create').id, 'create');
  assert.equal(tourForPath('/app/publish').id, 'publish');
  assert.equal(tourForPath('/app/publish/calendar/').id, 'publish-calendar');
  assert.equal(tourForPath('/app/projects/abc').id, 'projects');
});

test('unregistered feature pages get a generic tour; admin and public pages get none', () => {
  assert.equal(tourForPath('/app/publish/inbox').id, 'page:publish/inbox');
  assert.equal(tourForPath('/app/admin/users'), null);
  assert.equal(tourForPath('/pricing'), null);
  assert.equal(tourForPath('/application'), null);
});

test('seen list is tolerant of junk and bounded', () => {
  assert.deepEqual(parseSeen('nope'), []);
  assert.deepEqual(parseSeen('{"a":1}'), []);
  assert.deepEqual(parseSeen('["a",3]'), ['a']);
  assert.deepEqual(addSeen(['a'], 'a'), ['a']);
  assert.equal(addSeen(Array.from({ length: 80 }, (_, i) => `t${i}`), 'new').length, 80);
});
