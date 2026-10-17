import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('weekly plans are defined for Credits, Cinema Pass and Veyrnox.ai Publish', () => {
  const credits = read('packages/db/schema/supabase/0338_weekly_credit_subscriptions.sql');
  const cinema = read('packages/db/schema/supabase/0339_weekly_cinema_pass.sql');
  const publish = read('packages/db/schema/supabase/0340_weekly_social_publish_plan.sql');

  assert.match(credits, /'starter-weekly', 'week', 499, 60/);
  assert.match(credits, /'plus-weekly', 'week', 1499, 275/);
  assert.match(credits, /'ultra-weekly', 'week', 3299, 700/);
  assert.match(credits, /'billing_interval', p\.billing_interval/);
  assert.match(cinema, /price_usd_cents = 299/);
  assert.match(cinema, /active = true/);
  assert.match(publish, /'publish-weekly', 'Publish Plan', 'week', 499/);
});

test('Veyrnox.ai Publish offers an annual plan at exactly 30% off monthly', () => {
  const annual = read('packages/db/schema/supabase/0341_annual_social_publish_plan.sql');
  const publish = read('app/veyrnox/app/publish/plan/PublishPlanPanel.js');

  assert.match(annual, /'publish-annual', 'Publish Plan', 'year', 12600/);
  assert.equal(12600, 1500 * 12 * 0.7);
  assert.match(publish, /Save 30%/);
  assert.match(publish, /per month equivalent/);
});

test('all three paywalls disclose and render weekly billing', () => {
  // The offer's words are in the English catalog (ADR-0107).
  const credits = read('app/veyrnox/_components/CreditSubscriptions.js') + read('lib/i18n/messages/en.mjs');
  const cinema = read('app/veyrnox/social-cinema/pass/PassPanel.js');
  const publish = read('app/veyrnox/app/publish/plan/PublishPlanPanel.js');

  assert.match(credits, /Credits every week or month/);
  assert.match(credits, /every \{intervalName\(plan\.billing_interval\)\}/);
  assert.match(cinema, /INTERVAL = \{ week: 'week', month: 'month', year: 'year' \}/);
  assert.match(publish, /every \{intervalName\(selectedPlan\.billing_interval\)\}/);
  for (const source of [credits, cinema, publish]) assert.match(source, /cancel/i);
});
