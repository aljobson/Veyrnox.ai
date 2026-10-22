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

  for (const price of ['$0.00', '$4.99', '$15.00', '$126.00']) assert.ok(html.includes(price), price);
  for (const cadence of ['week', 'month', 'year']) {
    assert.ok(html.includes(appMessages[`app.publish.plan.cadence.${cadence}`]));
  }
  assert.equal(html.split('href="/app/publish/plan"').length - 1, 3);
  assert.ok(html.includes(appMessages['app.publish.plan.accountsFeature']));
  assert.ok(html.includes(appMessages['app.publish.plan.commentsFeature']));
  assert.doesNotMatch(html, /Manage billing|Cancel plan|Current plan/);
});
