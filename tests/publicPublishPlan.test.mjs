import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { fixture } from './helpers/publicSiteRender.mjs';

test('public Publish page shows every plan before sign-in', async () => {
  const appMessages = await appMessagesFor('en');
  const f = fixture('en', '/publish');
  const Page = f.load('app/veyrnox/publish/page.js').default;
  const html = f.render(React.createElement(React.Fragment, null, await Page()));

  for (const price of ['$0.00', '$4.99', '$15.00', '$125.99']) assert.ok(html.includes(price), price);
  for (const cadence of ['week', 'month', 'year']) {
    assert.ok(html.includes(appMessages[`app.publish.plan.cadence.${cadence}`]));
  }
  assert.equal(html.split('href="/app/publish/plan"').length - 1, 3);
  assert.ok(html.includes(appMessages['app.publish.plan.accountsFeature']));
  assert.ok(html.includes(appMessages['app.publish.plan.commentsFeature']));
  assert.doesNotMatch(html, /Manage billing|Cancel plan|Current plan/);
});

test('Publish annual price: the plan row, the public page and both store catalogs agree at $125.99', async () => {
  const { readFileSync } = await import('node:fs');
  const { storeBillingCatalog } = await import('../scripts/store-billing-catalog.mjs');
  const migration = readFileSync(new URL('../packages/db/schema/supabase/0555_publish_annual_price_12599.sql', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/veyrnox/publish/page.js', import.meta.url), 'utf8');
  assert.match(migration, /SET price_usd_cents = 12599/);
  assert.match(migration, /price_usd_cents IN \(12600, 12599\)/);
  assert.match(migration, /affected <> 1/);
  assert.match(page, /id: 'publish-annual', billingInterval: 'year', priceUsdCents: 12599/);
  const annual = storeBillingCatalog().filter((p) => p.offering === 'publish' && p.period === 'year');
  assert.equal(annual.length, 2);
  for (const row of annual) assert.equal(row.priceUsdCents, 12599, row.store);
});
