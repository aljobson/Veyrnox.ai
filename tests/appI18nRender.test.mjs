import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers/publicSiteRender.mjs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { localeInfo } from '../lib/i18n/locales.mjs';

const chatState = () => [[{ id: 'fixture-model', name: 'Fixture Model', maker: 'openai', credits_per_reply: 1, max_reply_tokens: 1024, options: {} }], [], null, 'all', null, [], 'fixture-model', '', [], false, { thinking: false, web: false, research: false }, { maxAttachments: 4, maxEdge: 2048 }, false, [], null, false, '', false, 'chat', '', null, false, false, false, 0, true];
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

for (const locale of ['de', 'ja', 'ar']) for (const area of ['create', 'library', 'publish', 'account', 'chat']) {
  test(`offline signed-in component render: /app/${area} in ${locale}`, async () => {
    const previous = globalThis.window, previousFlag = process.env.LOCALES_ENABLED;
    process.env.LOCALES_ENABLED = 'true';
    globalThis.window = { location: { search: '' }, localStorage: { getItem: () => null } };
    try {
      const messages = await appMessagesFor(locale);
      const source = `app/veyrnox/app/${area}/page.js`;
      const f = fixture('en', `/app/${area}`, {
        signedIn: true,
        moduleMocks: { 'next/headers': { headers: async () => new Map([['x-site-locale', locale], ['x-site-path', `/app/${area}`]]) } },
        states: { [source]: [], 'app/veyrnox/_components/chat/ChatWorkspace.js': chatState() },
      });
      const Page = f.load(source).default;
      const Template = f.load('app/veyrnox/app/template.js').default;
      const html = f.render(await Template({ children: React.createElement(Page) }));
      assert.ok(html.includes(`data-app-locale="${locale}"`), 'app provider overrides the persistent English public provider');
      assert.ok(html.includes(`dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`));
      const key = { create: 'app.create.promptOrPreset', library: 'app.library.title', publish: 'app.publish.loadingAccounts', account: 'app.account.billing', chat: 'app.chat.workOn' }[area];
      assert.ok(html.includes(escape(messages[key])), `${locale} ${area}: ${key}`);
      assert.doesNotMatch(html, />app\.(?:nav|account|create|library|publish|chat)\./);
      if (area === 'account') assert.ok(html.includes('data-testid="account-new-password"'), 'signed-in controls, not signed-out fallback');
      if (area === 'library') assert.ok(html.includes('data-testid="library-types"'), 'hydrated signed-in Library');
      if (area === 'chat') assert.ok(html.includes('data-testid="chat-conversation"'), 'ready chat, not loading screen');
    } finally {
      if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
      if (previousFlag === undefined) delete process.env.LOCALES_ENABLED; else process.env.LOCALES_ENABLED = previousFlag;
    }
  });
}

test('Arabic document direction and touched layout edges use logical placement', () => {
  assert.equal(localeInfo('ar').dir, 'rtl');
  assert.equal(localeInfo('ar').hreflang, 'ar');
  const root = readFileSync('app/layout.js', 'utf8');
  assert.match(root, /<html lang=\{info.hreflang\} dir=\{info.dir\}/);
  for (const file of ['app/veyrnox/_components/NavBar.js', 'app/veyrnox/_components/chat/ChatWorkspace.js', 'app/veyrnox/app/library/page.js', 'app/veyrnox/app/create/page.js']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /(?:className=|className:[^\n]*)[^\n]*(?:\b(?:left|right|ml|mr|pl|pr)-|\bborder-[lr](?:-|\s))/, file);
  }
});
