import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { compile } from 'tailwindcss';
import { CATALOGS, translator, tOr } from '../lib/i18n/translate.mjs';
import { CONTENT_TYPES, AI_DISCLOSURES, CINEMA_CATEGORIES } from '../lib/cinema/domain.js';
import { CINEMA_RATINGS, CINEMA_WARNING_CODES } from '../lib/cinema/safetyPolicy.js';
import { NETWORKS } from '../app/lib/socialConnectClient.js';
import { HELP_ACTIONS } from '../lib/productHelp.js';
import { physicalVeyPanelSide } from '../lib/veyPlacement.js';
import { mobileDockPosition } from '../lib/veyMobileLayout.js';
import { resolveI18nSource } from '../scripts/lib/vey-knowledge-i18n.mjs';

const families = {
  'cinema.category': 'drama', 'cinema.type': 'FILM', 'cinema.disclosure': 'generated_voice',
  'cinema.rating': 'PG', 'cinema.warning': 'violence', 'cinema.report': 'spam',
  'cinema.pass': 'monthly', 'cinema.discovery.empty': 'all',
  'social.role': 'editor', 'social.status': 'pending', 'social.resource': 'Page', 'social.connect': 'channel',
  'presets.cat': 'ALL', 'public.library': 'video', 'public.vey.action': 'open_create',
  'public.vey.question': 'Help me make my first image', 'public.vey.step': 'recover.title',
  'search.page': 'home', 'search.group': 'Pages', 'model.mode': 'text-to-video', 'home.models': 'video', 'home.faq': '0.q',
  'mcp': 'title', 'mcp.pub': 'lead', 'mcp.tool': 'list_models', label: 'Generate',
};
const keyPattern = /^[a-z]+(\.[A-Za-z0-9_-]+)+$/;
for (const [family, known] of Object.entries(families)) {
  test(`${family}: unknown values render fallback, known values translate in en and ar`, () => {
    for (const locale of ['en', 'ar']) {
      const t = translator(locale), key = `${family}.${known}`;
      assert.ok(t.messages[key], key);
      assert.equal(tOr(t, key, 'Server display label'), t(key));
      for (const fallback of ['Server display label', 'future-value']) {
        const value = tOr(t, `${family}.future_value`, fallback);
        assert.equal(value, fallback);
        assert.doesNotMatch(value, keyPattern);
        assert.equal(renderToStaticMarkup(React.createElement('span', null, value)), `<span>${fallback}</span>`);
      }
    }
  });
}

test('fallbacks preserve slots and unlisted caller labels without confusing equal key/value translations', () => {
  const t = translator('ar');
  assert.equal(tOr(t, 'unknown.key', 'Server limit {n}', { n: 2 }), 'Server limit 2');
  assert.equal(t.label('Custom caller label'), 'Custom caller label');
  assert.equal(t.label('Generate'), t('label.Generate'));
  const identity = Object.assign(key => key, { messages: { 'literal.key': 'literal.key' } });
  assert.equal(tOr(identity, 'literal.key', 'fallback'), 'literal.key');
});

test('every Cinema enum, resource, billing interval and bounded picker value has all eleven catalog entries', () => {
  const sets = {
    'cinema.category': CINEMA_CATEGORIES.map(([slug]) => slug), 'cinema.type': CONTENT_TYPES,
    'cinema.disclosure': AI_DISCLOSURES, 'cinema.rating': CINEMA_RATINGS.map(([code]) => code),
    'cinema.warning': CINEMA_WARNING_CODES.map(([code]) => code),
    'cinema.report': ['spam', 'abuse', 'privacy', 'rights', 'other'],
    'cinema.pass': ['week', 'month', 'weekly', 'monthly'],
    'cinema.discovery.empty': ['all', 'allCategory', 'series', 'seriesCategory', 'voting', 'votingCategory'],
    'social.resource': [...NETWORKS.map(n => n.resource).filter(Boolean), 'destination'],
    'social.role': ['manager', 'editor', 'reviewer', 'analyst', 'viewer'],
    'social.status': ['pending', 'approved', 'rejected', 'canceled', 'accepted', 'revoked', 'expired'],
    'social.connect': ['channel', 'limitOne', 'noResource', 'expired', 'browser', 'used', 'signedOut'],
    'public.library': ['image', 'video', 'audio', 'images', 'videos'],
    'public.vey.action': Object.keys(HELP_ACTIONS),
    mobile: ['minutesAgo', 'hoursAgo', 'now'],
  };
  for (const [locale, messages] of Object.entries(CATALOGS)) {
    for (const [family, values] of Object.entries(sets)) {
      for (const value of values) assert.equal(typeof messages[`${family}.${value}`], 'string', `${locale}: ${family}.${value}`);
    }
  }
});

test('new dynamic key call sites use fallback lookup rather than raw t(template) or t(prefix + value)', () => {
  const files = [
    'app/veyrnox/social-cinema/CinemaDiscovery.js', 'app/veyrnox/social-cinema/CinemaComments.js',
    'app/veyrnox/social-cinema/creator/CreatorWorkspace.js', 'app/veyrnox/social-cinema/title/[id]/TitlePage.js',
    'app/veyrnox/social-cinema/pass/PassPanel.js', 'app/social/connect/callback/[network]/page.js',
    'app/social/review/[token]/page.js', 'app/social/team/invite/[token]/page.js',
    ...['SiteSearch.js', 'LibraryPicker.js', 'CreditSubscriptions.js', 'MascotAssistant.jsx', 'VeyTaskGuide.jsx', 'VeyConversation.jsx'].map(f => `app/veyrnox/_components/${f}`),
    'app/veyrnox/m/explore/page.js', 'app/veyrnox/presets/[id]/page.js', 'app/veyrnox/mcp/page.js',
  ];
  for (const file of files) {
    const tree = ts.createSourceFile(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    function visit(node) {
      if (ts.isCallExpression(node) && /^(t|translate)$/.test(node.expression.getText(tree))) {
        const key = node.arguments[0];
        assert.ok(!ts.isTemplateExpression(key) && !ts.isBinaryExpression(key), `${file}: ${node.getText(tree)}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
});

test('Vey logical utilities compile to inline edges with unchanged spacing; RTL docking mirrors the panel', async () => {
  const compiler = await compile('@theme { --spacing: 0.25rem; } @tailwind utilities;');
  const css = compiler.build(['start-2', 'end-2', 'start-3', 'end-3', 'end-4']);
  for (const [side, edge, n] of [['start', 'start', 2], ['end', 'end', 2], ['start', 'start', 3], ['end', 'end', 3], ['end', 'end', 4]]) {
    assert.ok(css.includes(`.${side}-${n} {\n  inset-inline-${edge}: calc(var(--spacing) * ${n});`));
  }
  for (const locale of ['en', 'ar']) {
    for (const side of ['left', 'right']) {
      const physical = physicalVeyPanelSide(side, locale);
      assert.equal(physical, locale === 'ar' ? (side === 'left' ? 'right' : 'left') : side);
      const home = mobileDockPosition({ width: 390, height: 844 }, null, false, physical, locale === 'ar');
      assert.ok(locale === 'ar' ? home.x > 195 : home.x < 195);
      const panel = physical === 'left' ? { left: 8, right: 288, top: 650 } : { left: 102, right: 382, top: 650 };
      const mascot = mobileDockPosition({ width: 390, height: 844 }, panel, true, physical);
      assert.ok(physical === 'left' ? mascot.x > panel.right : mascot.x < panel.left);
    }
  }
});

test('knowledge scanner resolves safe catalog lookups and their literal fallbacks', () => {
  const source = '<><h1>{tOr(t, "known.title", "Server title")}</h1><p>{tOr(t, "future.title", "Fallback {n}", { n: 2 })}</p></>';
  assert.equal(resolveI18nSource(source, { 'known.title': 'Catalog title' }), '<><h1>Catalog title</h1><p>Fallback 2</p></>');
});
