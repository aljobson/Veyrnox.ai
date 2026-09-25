import test from 'node:test';
import assert from 'node:assert/strict';
import { needsNonceDocument } from '../lib/nonceNavigation.mjs';

test('app entry, query strings, callback and redirected aliases require a new document', () => {
  for (const href of ['/app', '/app?auth=sign_up', '/app#create', '/app/create?model=wan', '/auth/callback?code=example', '/veyrnox/app/credits']) {
    assert.equal(needsNonceDocument(href), true, href);
  }
});
test('public, same-page and unrelated-prefix links keep ordinary routing', () => {
  for (const href of ['/', '/pricing', '/presets', '/m', '/application', '/author', '#main', '/legal/terms', 'mailto:legal@veyrnox.com']) {
    assert.equal(needsNonceDocument(href), false, href);
  }
});
