import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { fixture } from './helpers/publicSiteRender.mjs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { translator, pluralKey } from '../lib/i18n/translate.mjs';
import { localeTag, LOCALES } from '../lib/i18n/locales.mjs';
import { candidates } from '../scripts/audit-public-i18n.mjs';
import { controlLabels, referencedControlLabels } from '../scripts/lib/vey-knowledge-i18n.mjs';

const composer = 'app/veyrnox/app/publish/Composer.js';
const workspace = 'app/veyrnox/_components/editor/MultitrackWorkspace.js';
const analytics = 'app/veyrnox/app/publish/analytics/page.js';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const post = { id: 'post', type: 'video', caption: 'User caption #unchanged', published_at: '2026-10-18T12:00:00Z', metrics: { likes: 1234, comments: 2, views: 9000, shares: 3, reach: 4000 } };

test('continuation files have zero unresolved literals without file exemptions', () => {
  for (const file of [composer, workspace, analytics]) assert.deepEqual(candidates(file, readFileSync(file, 'utf8'), { app: true }).filter(row => row.status === 'unresolved'), [], file);
  const result = candidates('test.jsx', `function App() { document.body.closest('button,a'); return <button title="Still untranslated">Visible copy</button>; }`, { app: true });
  assert.deepEqual(result.filter(row => row.status === 'unresolved').map(row => row.text), ['Still untranslated', 'Visible copy']);
});

test('stable editor hooks retain their actual accessible labels in generated knowledge', () => {
  const labels = controlLabels(readFileSync(workspace, 'utf8'));
  assert.equal(labels.get('editor-sections'), 'Mobile editor sections');
  assert.deepEqual(referencedControlLabels(readFileSync('app/veyrnox/_lib/useVeyMobileLayout.js', 'utf8'), labels), ['Mobile editor sections']);
  assert.deepEqual(referencedControlLabels(`document.querySelector('[data-testid="not-present"]')`, labels), []);
});

test('continuation policy numbers and original English survive all eleven catalogs', async () => {
  const baseline = JSON.parse(readFileSync('tests/fixtures/app-continuation-policy-main.json', 'utf8'));
  const english = await appMessagesFor('en');
  for (const { code } of LOCALES) {
    const messages = await appMessagesFor(code);
    for (const [key, value] of Object.entries(baseline.messages)) {
      assert.equal(english[key], value, key);
      assert.deepEqual(messages[key].match(/\d+(?:[.,]\d+)*/g), value.match(/\d+(?:[.,]\d+)*/g), `${code}: ${key}`);
    }
  }
});

for (const locale of ['en', 'de', 'ja', 'ar']) {
  test(`Composer, editor and populated analytics render translated copy: ${locale}`, async () => {
    const messages = await appMessagesFor(locale);
    const t = translator(locale, messages);
    function render(file, name, props = {}, states) {
      const f = fixture(locale, '/app/publish', { messages, signedIn: true, states: states ? { [file]: states } : {}, expose: { [composer]: ['TargetBadge'], [analytics]: ['AccountAnalytics', 'ContentPerformance', 'CapabilityMatrix'] } });
      return f.render(React.createElement(f.load(file)[name], props));
    }
    const composerHtml = render(composer, 'Composer', { accounts: [{ id: 'account', status: 'active', network: 'instagram', display_name: 'User account', supportedMedia: ['image'] }], approvalsEnabled: true, variantsEnabled: true });
    assert.ok(composerHtml.includes('data-testid="publish-caption"'));
    assert.ok(composerHtml.includes('Instagram'));
    assert.ok(composerHtml.includes(escape(t('app.publish.composer.reviewersRequired'))) === false, 'validation does not appear before submit');
    const unknown = render(composer, 'TargetBadge', { target: { network: 'future_network', publish_status: 'future_status' } });
    assert.ok(unknown.includes('future_status'));
    const known = render(composer, 'TargetBadge', { target: { network: 'instagram', publish_status: 'delivered' } });
    assert.ok(known.includes(escape(t('app.publish.composer.status.delivered'))));
    const workspaceHtml = render(workspace, 'MultitrackWorkspace', { onCredits() {} });
    assert.ok(workspaceHtml.includes(`data-testid="editor-sections" aria-label="${escape(t('app.editor.workspace.mobileSections'))}"`));
    assert.ok(workspaceHtml.includes(escape(t('app.editor.workspace.guidance.empty.body'))));
    assert.ok(workspaceHtml.includes('data-testid="editor-stage-inspector"'));
    const data = { posts: [post], evolution: [{ date: '2026-10-18', metrics: { followers: 2345, views: 9000, posts_count: 1 } }], sync: { last_ok_at: '2026-10-18T12:00:00Z' } };
    const accountHtml = render(analytics, 'AccountAnalytics', { account: { id: 'account', network: 'youtube' }, range: { from: '2026-10-01', to: '2026-10-18' }, includeContent: true }, [{ current: data, previous: null }, '', 0]);
    assert.ok(accountHtml.includes(escape(t('app.publish.analytics.youtubePolicy'))));
    assert.ok(accountHtml.includes(escape(t('app.publish.analytics.subscriberEngagement'))));
    assert.ok(accountHtml.includes(escape((2345).toLocaleString(localeTag(locale)))));
    assert.ok(accountHtml.includes('User caption #unchanged'));
    const waitingHtml = render(analytics, 'AccountAnalytics', { account: { id: 'account', network: 'youtube' }, range: {}, includeContent: true }, [{ current: { posts: [], evolution: [], sync: {} }, previous: null }, '', 0]);
    assert.ok(waitingHtml.includes(escape(t('app.publish.analytics.awaitNumbers'))));
    const reconnectHtml = render(analytics, 'AccountAnalytics', { account: { id: 'account', network: 'youtube' }, range: {}, includeContent: true }, [{ current: { posts: [], evolution: [], sync: { failing: true } }, previous: null }, '', 0]);
    assert.match(reconnectHtml, /data-testid="publish-analytics-reconnect" href="\/app\/publish"/);
    assert.ok(reconnectHtml.includes(escape(t('app.publish.analytics.reconnect'))));
    const performanceHtml = render(analytics, 'ContentPerformance', { posts: [post] });
    assert.ok(performanceHtml.includes(escape(t('app.publish.analytics.performance'))));
    assert.ok(performanceHtml.includes(escape(t('app.publish.analytics.type.video'))));
    const capabilityHtml = render(analytics, 'CapabilityMatrix', { accounts: [{ id: 'account', network: 'youtube', display_name: 'User account' }, { id: 'unknown', network: 'future_network' }] });
    assert.ok(capabilityHtml.includes(escape(t('app.publish.analytics.subscribers'))));
    assert.ok(capabilityHtml.includes('future_network'));
    for (const count of [0, 1, 2, 3, 11, 21]) {
      for (const family of ['supported', 'failed', 'missing']) assert.ok(messages[pluralKey(t, locale, `app.publish.analytics.${family}`, count)]);
    }
    for (const html of [composerHtml, unknown, known, workspaceHtml, accountHtml, performanceHtml, capabilityHtml]) assert.doesNotMatch(html, /app\.(?:publish|editor)\.|\{(?:count|network|date)\}/);
  });
}
