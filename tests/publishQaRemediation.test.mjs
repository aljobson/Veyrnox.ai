import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activityLabel, canEditPublishing, reportDeliverySummary } from '../app/veyrnox/_lib/publishPresentation.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('publishing edits require an explicitly loaded write role', () => {
  for (const role of [null, undefined, '', 'viewer', 'analyst', 'reviewer']) assert.equal(canEditPublishing(role), false);
  for (const role of ['owner', 'manager', 'editor']) assert.equal(canEditPublishing(role), true);
});

test('activity uses customer language for later Publish and inbox features', () => {
  assert.equal(activityLabel('save_publish_autolist'), 'Saved an RSS Autolist');
  assert.equal(activityLabel('contact_import'), 'Imported contacts');
  assert.equal(activityLabel('internal_note'), 'Added an internal note');
  assert.equal(activityLabel('new_future_event'), 'New future event');
  assert.equal(activityLabel(null), 'Updated publishing settings');
});

test('manual reports never promise automatic email delivery', () => {
  assert.equal(reportDeliverySummary({ delivery_cadence: 'manual', delivery_recipients: ['a@test.ai'] }), 'Run and download this report manually.');
  assert.equal(reportDeliverySummary({ delivery_cadence: 'weekly', delivery_format: 'pdf', delivery_recipients: ['a@test.ai'] }), 'Delivers PDF to 1 recipient');
  assert.equal(reportDeliverySummary({ delivery_cadence: 'monthly', delivery_format: 'pptx', delivery_recipients: ['a@test.ai', 'b@test.ai'] }), 'Delivers PPTX to 2 recipients');
});

test('plan identity is withheld until the plan request resolves and can be retried', () => {
  const source = read('app/veyrnox/app/publish/plan/PublishPlanPanel.js');
  assert.ok(source.indexOf('if (!data) return') < source.indexOf("paid ? 'Publish Plan' : 'Free'"));
  assert.match(source, /Loading your Publish plan/);
  assert.match(source, /onClick=\{load\}>Try again/);
});

test('analytics scrolls charts inside shrinkable containers', () => {
  const source = read('app/veyrnox/app/publish/inbox/InboxAnalytics.js');
  assert.doesNotMatch(source, /h-28 min-w-max/);
  assert.match(source, /min-w-0 max-w-full overflow-x-auto/);
});

test('queues and autolists mount account-scoped content only after sign-in', () => {
  for (const name of ['queues', 'autolists']) {
    const source = read(`app/veyrnox/app/publish/${name}/page.js`);
    assert.match(source, /useSyncExternalStore/);
    assert.match(source, /key=\{account\}/);
    assert.match(source, /setBrandRole\([^;]*\|\|'viewer'\)/);
    assert.match(source, /canEditPublishing\(brandRole\)/);
    assert.doesNotMatch(source, /useState\('owner'\)/);
  }
});
