import english from '../lib/i18n/messages/en.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('every insufficient-credit creation surface links to billing', () => {
  const create = read('app/veyrnox/app/create/page.js');
  const videoAgent = read('app/veyrnox/app/video-agent/page.js');
  const edit = read('app/veyrnox/_components/EditSheet.js');
  for (const source of [create, videoAgent, edit]) assert.match(source, /href="\/app\/credits"/);
});

test('account exposes billing management and Cinema cancellation uses an accessible confirmation', () => {
  const account = read('app/veyrnox/app/account/page.js');
  const pass = read('app/veyrnox/social-cinema/pass/PassPanel.js');
  assert.match(account, /Billing &amp; subscriptions/);
  assert.match(account, /href="\/app\/credits#credit-subscriptions"/);
  assert.match(pass, /cinema.passPanel.aCinemaPassUnlocksEveryPublished/);
  assert.match(english['cinema.passPanel.aCinemaPassUnlocksEveryPublished'], /1,500 delivered minutes each calendar month/);
  assert.match(pass, /<ConfirmDialog/);
  assert.doesNotMatch(pass, /window\.confirm/);
});

test('subscription launches have versioned consent, complete legal disclosures and staging-only sales', () => {
  const config = read('wrangler.jsonc');
  const subscriptions = read('lib/subscriptions/api.js');
  const passApi = read('lib/cinema/passApi.js');
  const terms = read('app/legal/terms/page.js');
  const refunds = read('app/legal/refund/page.js');

  assert.match(subscriptions, /credit-subscription-2026-10-17/);
  assert.match(passApi, /cinema-pass-2026-10-16/);
  assert.match(terms, /Credit Subscriptions/);
  assert.match(terms, /Subscription Credits[\s\S]{0,300}do not roll over/);
  assert.match(terms, /Cinema Pass[\s\S]{0,500}renews automatically each week or month/);
  assert.match(terms, /Veyrnox.ai Publish Plan[\s\S]{0,500}weekly, monthly or annual/);
  assert.match(refunds, /Within 14 days of the initial subscription payment/);
  assert.match(refunds, /refund the unused share of that paid period/);
  assert.match(refunds, /How to cancel/);

  assert.match(config, /"SUBSCRIPTIONS_ENABLED": "false"[\s\S]*"SUBSCRIPTIONS_ENABLED": "true"/);
  assert.match(config, /"CINEMA_SUBSCRIPTIONS_ENABLED": "false"[\s\S]*"CINEMA_SUBSCRIPTIONS_ENABLED": "true"/);
  assert.match(config, /"VIOLATION_EMAIL_REPLY_TO": "support@veyrnox\.com"/);
  assert.doesNotMatch(config, /"SUBSCRIPTION_ALERT_EMAIL"/);
});

test('Cinema Pass staging availability comes from a public no-store plan projection', () => {
  const route = read('app/api/cinema-pass-plans/route.js');
  const panel = read('app/veyrnox/social-cinema/pass/PassPanel.js');
  assert.match(route, /passHandler\(\{ action: 'plans', authed: false \}\)/);
  assert.match(route, /dynamic = 'force-dynamic'/);
  assert.match(panel, /fetch\('\/api\/cinema-pass-plans', \{ cache: 'no-store'/);
  assert.match(panel, /effectiveSalesOpen = preview \|\| salesOpen === true/);
});
