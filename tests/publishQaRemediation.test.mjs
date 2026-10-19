import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activityLabel, canEditPublishing, reportDeliverySummary } from '../app/veyrnox/_lib/publishPresentation.js';
import english from '../lib/i18n/messages/app/en.mjs';
import * as presentation from '../app/veyrnox/_lib/publishPresentation.js';

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

test('initial and older activity requests explain the Publish Plan requirement with the plan destination', () => {
  for (const older of [false, true]) {
    assert.deepEqual(presentation.activityLoadError({ status: 402, code: 'plan_required' }, older), {
      message: 'The Publish Plan is required to view brand activity.', planHref: '/app/publish/plan',
    });
    assert.deepEqual(presentation.activityLoadError({ status: 403 }, older), {
      message: 'Your role cannot view the brand activity log.', planHref: null,
    });
  }
});

test('activity network and service failures retain generic copy without a plan link', () => {
  for (const error of [undefined, new Error('offline'), { status: 500 }]) {
    assert.deepEqual(presentation.activityLoadError(error), { message: 'Could not load brand activity. Try again.', planHref: null });
    assert.deepEqual(presentation.activityLoadError(error, true), { message: 'Could not load older activity. Try again.', planHref: null });
  }
});

test('both activity error paths render the shared message and explicit plan link', () => {
  const source = read('app/veyrnox/app/publish/activity/page.js');
  assert.match(source, /setError\(activityLoadError\(next\)\)/);
  assert.match(source, /setError\(activityLoadError\(next, true\)\)/);
  assert.match(source, /href=\{error\.planHref\}/);
  assert.match(source, /\{error\.message\}/);
});

test('manual reports never promise automatic email delivery', () => {
  assert.equal(reportDeliverySummary({ delivery_cadence: 'manual', delivery_recipients: ['a@test.ai'] }), 'Run and download this report manually.');
  assert.equal(reportDeliverySummary({ delivery_cadence: 'weekly', delivery_format: 'pdf', delivery_recipients: ['a@test.ai'] }), 'Delivers PDF to 1 recipient');
  assert.equal(reportDeliverySummary({ delivery_cadence: 'monthly', delivery_format: 'pptx', delivery_recipients: ['a@test.ai', 'b@test.ai'] }), 'Delivers PPTX to 2 recipients');
});

test('plan identity is withheld until the plan request resolves and can be retried', () => {
  const source = read('app/veyrnox/app/publish/plan/PublishPlanPanel.js');
  assert.ok(source.indexOf('if (!data) return') < source.indexOf('paid ? t("publish.plan.colPlan") : t("publish.plan.colFree")'));
  assert.equal(english['app.publish.plan.loading'], 'Loading your Publish plan…');
  assert.match(source, /onClick=\{load\}>\{t\("recovery.retry"\)\}/);
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
