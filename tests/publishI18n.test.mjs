import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { fixture } from './helpers/publicSiteRender.mjs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { translator, pluralKey } from '../lib/i18n/translate.mjs';
import { candidates } from '../scripts/audit-public-i18n.mjs';
import { LOCALES } from '../lib/i18n/locales.mjs';
import { appFiles } from '../scripts/audit-public-i18n.mjs';
import ts from 'typescript';

const prefix = 'app/veyrnox/app/publish/';
const completed = ['ApprovalRequests.js', 'BlueskyConnect.js', 'BrandSwitcher.jsx', 'DeviceUploads.js', 'DraftReview.js', 'NetworkLogo.js', 'page.js', 'smartlink/page.js', 'plan/page.js', 'plan/PublishPlanPanel.js', 'analytics/FollowersChart.js', 'inbox/InboxReplySuggestions.js'];
test('completed Publish components retain zero unresolved literals', () => {
  for (const name of completed) {
    const file = prefix + name;
    assert.deepEqual(candidates(file, readFileSync(file, 'utf8'), { app: true }).filter(row => row.status === 'unresolved'), [], name);
  }
});

test('SVG geometry classification does not exempt visible labels or malformed path copy', () => {
  const source = `const paths = { example: 'M0 0 L1 1Z' }; function Logo() { return <svg aria-label="Brand icon"><path d={paths[network]}/></svg> }`;
  assert.deepEqual(candidates('logo.js', source, { app: true }).filter(row => row.status === 'unresolved').map(row => row.text), ['Brand icon']);
  assert.ok(candidates('logo.js', source.replace('M0 0 L1 1Z', 'Untranslated copy'), { app: true }).some(row => row.text === 'Untranslated copy'));
});

test('Publish policy English matches main and every translated policy retains its numbers', async () => {
  const baseline = JSON.parse(readFileSync('tests/fixtures/publish-policy-main.json', 'utf8'));
  const en = await appMessagesFor('en');
  const numbers = value => value.match(/\d+(?:[.,]\d+)*/g) || [];
  for (const { code } of LOCALES) {
    const messages = await appMessagesFor(code);
    for (const [key, original] of Object.entries(baseline.messages)) {
      assert.equal(en[key], original, key);
      assert.deepEqual(numbers(messages[key]), numbers(original), `${code}: ${key}`);
    }
  }
});

test('translated Publish labels do not become option values, identifiers or comparison operands', () => {
  for (const file of appFiles().filter(file => file.startsWith(prefix))) {
    const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    function visit(node) {
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) assert.ok(!node.parameters.some(parameter => parameter.name.getText(tree) === 't'), `${file}: callback shadows the translator`);
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 't') {
        const parent = node.parent;
        if (ts.isBinaryExpression(parent)) assert.ok(![ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind), file);
        if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) assert.ok(!['value', 'id', 'key', 'name'].includes(parent.parent.name.text), file);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
});

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
for (const locale of ['en', 'de', 'ja', 'ar']) {
  test(`Publish loaded components render translated copy and preserve user content: ${locale}`, async () => {
    const messages = await appMessagesFor(locale);
    const t = translator(locale, messages);
    const snapshot = { brandId: 'fixture', revision: 1 };
    const smartlink = prefix + 'smartlink/page.js';
    const plan = prefix + 'plan/PublishPlanPanel.js';
    const drafts = prefix + 'DraftReview.js';
    const uploads = prefix + 'DeviceUploads.js';
    const approvals = prefix + 'ApprovalRequests.js';
    const f = fixture(locale, '/app/publish', {
      messages, signedIn: true,
      expose: { [smartlink]: ['Editor'], [plan]: ['Plan'] },
      states: {
        [smartlink]: [{ slug: 'fixture', title: 'User title unchanged', bio: '', avatarUrl: '', theme: 'midnight', published: false, items: [{ id: 'link', label: 'User link unchanged', url: 'https://example.invalid', enabled: true, clicks: 21 }] }, { views: 1234, clicks: 21 }, false, false, '', false, 'owner', snapshot, 0],
        [plan]: [{ entitlement: { tier: 'free' }, consent_version: 'fixture', plans: [{ id: 'publish-annual', billing_interval: 'year', price_usd_cents: 12600 }] }, '', false, false, 'publish-annual', false],
        [drafts]: [[{ id: 'draft', draft_batch_id: 'batch', scheduled_at: '2026-10-18T12:00:00Z', global_text: 'User caption unchanged', networks: ['instagram'], media: [] }], true, '', null],
        [uploads]: [[], false, '', '', null, false, null],
        [approvals]: [[{ id: 'request', global_text: 'User approval caption', scheduled_at: '2026-10-18T12:00:00Z', policy: 'all', status: 'future_status', reviewers: [] }], '', ''],
      },
      moduleMocks: {
        '../../../../lib/socialBrandSelection': { onSocialBrandChange: () => () => {}, getSocialBrandRevision: () => 1, assertSocialBrandSnapshot() {}, getSocialBrandSnapshot: () => snapshot },
      },
    });
    const render = (file, name = 'default', props = {}) => f.render(React.createElement(f.load(prefix + file)[name], props));
    const smartHtml = render('smartlink/page.js', 'Editor');
    assert.ok(smartHtml.includes(escape(t('app.publish.smartlink.save'))));
    assert.ok(smartHtml.includes('User link unchanged'));
    assert.ok(smartHtml.includes(escape(t(pluralKey(t, locale, 'app.publish.smartlink.clickCount', 21), { count: locale === 'en' ? 21 : (21).toLocaleString(locale) }))));
    const planHtml = render('plan/PublishPlanPanel.js', 'Plan');
    assert.ok(planHtml.includes(escape(t('app.publish.plan.save'))));
    assert.ok(planHtml.includes('<span lang="en" dir="ltr">Start my Publish Plan at $126.00 plus tax every year. I understand it renews automatically until I cancel.</span>'));
    const draftHtml = render('DraftReview.js', 'DraftReview');
    assert.ok(draftHtml.includes('User caption unchanged'));
    assert.ok(draftHtml.includes('Instagram'));
    assert.ok(draftHtml.includes(escape(t(pluralKey(t, locale, 'app.publish.drafts.count', 1), { count: locale === 'en' ? 1 : (1).toLocaleString(locale) }))));
    const uploadHtml = render('DeviceUploads.js', 'default', { onSelect() {} });
    assert.ok(uploadHtml.includes(escape(t('app.publish.uploads.limits'))));
    const approvalHtml = render('ApprovalRequests.js', 'ApprovalRequests');
    assert.ok(approvalHtml.includes('future_status'), 'unknown server value uses the explicit fallback');
    const replies = render('inbox/InboxReplySuggestions.js', 'default', { suggestions: [{ id: 'suggestion', status: 'pending', workflow_name: 'User workflow', keyword: 'User keyword', suggested_reply: 'Provider reply unchanged' }] });
    assert.ok(replies.includes(escape(t('app.publish.inbox.suggestions'))));
    assert.ok(replies.includes('Provider reply unchanged'));
    const chart = render('analytics/FollowersChart.js', 'FollowersChart', { series: [{ date: '2026-10-17', followers: 1200 }, { date: '2026-10-18', followers: 1234 }] });
    assert.ok(chart.includes(escape(t('app.publish.analytics.followers'))));
    for (const html of [smartHtml, planHtml, draftHtml, uploadHtml, approvalHtml, replies, chart]) assert.doesNotMatch(html, /app\.publish\.|\{(?:count|number|label|date)\}/);
  });
}
