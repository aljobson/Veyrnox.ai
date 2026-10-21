import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES } from '../lib/i18n/locales.mjs';
import { legalDocument } from '../lib/i18n/legal/catalogs.mjs';
import { fixture } from './helpers/publicSiteRender.mjs';

test('every privacy notice discloses necessary Sentry error reporting independently of analytics consent', async () => {
  for (const { code } of LOCALES) {
    const { messages, blocks, updated } = await legalDocument(code, 'privacy');
    assert.equal(updated, '21 October 2026');
    assert.match(messages.b060, /Sentry/);
    assert.match(messages.b072, /Sentry/);
    assert.ok(blocks.some(block => block.key === 'b072'));
    const f = fixture(code, '/legal/privacy', { moduleMocks: {
      '../../veyrnox/layout': { __esModule: true, default: () => null },
    } });
    const { LegalBlocks } = f.load('app/legal/_lib/LegalDocument.js');
    assert.ok(f.render(LegalBlocks({ blocks: [{ tag: 'p', key: 'b072' }], messages, locale: code })).includes('Sentry'));
  }
});
