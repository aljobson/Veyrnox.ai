import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import * as React from 'react';
import { fixture } from './helpers/publicSiteRender.mjs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { translator, messagesFor, tOr } from '../lib/i18n/translate.mjs';
import { LOCALES } from '../lib/i18n/locales.mjs';
import { emptyTimeline, removeClip } from '../app/veyrnox/_lib/editorTimeline.mjs';
import { trimEdge } from '../app/veyrnox/_lib/editorCommands.mjs';
import { transitionGuidance } from '../app/veyrnox/_lib/editorGuidance.mjs';
import { jobStateUi } from '../app/veyrnox/_lib/studioStates.js';
import { candidates, appFiles } from '../scripts/audit-public-i18n.mjs';

const base = 'app/veyrnox/_components/';
const noop = () => {};
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
}
const hooks = { ...React, useRef: initial => ({ current: initial }), useState: initial => [typeof initial === 'function' ? initial() : initial, noop], useEffect: noop, useLayoutEffect: noop };
async function interactive(locale, file, extra = {}) {
  const messages = { ...messagesFor(locale), ...await appMessagesFor(locale) };
  const i18n = { useI18n: () => ({ locale, t: translator(locale, messages), languagesEnabled: true }) };
  return fixture(locale, '/app/editor', { messages, moduleMocks: { react: hooks, '../../../../components/I18nProvider': i18n, '../../../components/I18nProvider': i18n, ...extra } });
}
for (const locale of ['de', 'ja']) test(`H1: rendered ${locale} clip callbacks select, trim and delete both stable tracks`, async () => {
  const file = base + 'editor/TimelineView.js';
  const f = await interactive(locale, file);
  const Timeline = f.load(file).TimelineView;
  for (const track of ['video', 'audio']) {
    let tl = { ...emptyTimeline(), media: { m: { id: 'm', name: 'User clip', kind: 'video', frames: 90, hasAudio: true } }, [track]: [{ id: 'clip', mediaId: 'm', in: 0, start: 0, len: 60, volume: 1 }] };
    let selected = null;
    const props = () => ({ tl, selected, ppf: 2, frame: 0, onSelect: value => { selected = value; }, onTrim: (...args) => { tl = trimEdge(tl, ...args); }, onSeek: noop, onMove: noop });
    let box = nodes(Timeline(props())).find(node => node.type?.name === 'ClipBox');
    const click = nodes(box.type(box.props)).find(node => node.type === 'button');
    click.props.onClick({ stopPropagation: noop });
    assert.deepEqual(selected, { track, id: 'clip' });
    assert.equal(tl[selected.track].find(c => c.id === selected.id).len, 60);
    box = nodes(Timeline(props())).find(node => node.type?.name === 'ClipBox');
    const handle = nodes(box.type(box.props)).find(node => node.type?.name === 'TrimHandle' && node.props.side === 'out');
    const button = handle.type(handle.props);
    button.props.onKeyDown({ key: 'ArrowLeft', preventDefault: noop, stopPropagation: noop });
    assert.equal(tl[track][0].len, 59);
    tl = removeClip(tl, selected.track, selected.id);
    assert.equal(tl[track].length, 0);
    assert.equal(nodes(Timeline(props())).filter(node => node.type?.name === 'ClipBox').length, 0);
  }
});

test('M2: source and target selects have independent fixed reconciliation keys', async () => {
  const file = base + 'editor/CaptionTranslationControls.js';
  const f = await interactive('de', file);
  const tree = f.load(file).CaptionTranslationControls({ tl: { text: [] }, onBusy: noop });
  const labels = nodes(tree).filter(node => node.type === 'label');
  assert.deepEqual(labels.map(node => node.key), ['source', 'target']);
});

test('M3: all transition branches render translated guidance and action labels', async () => {
  const tl = { video: [{ id: 'first', start: 0, len: 30, trackId: 'v' }] };
  for (const locale of ['de', 'ja']) {
    const messages = await appMessagesFor(locale), t = translator(locale, messages);
    const f = fixture(locale, '/app/editor', { messages });
    for (const selected of [null, { track: 'audio' }, { track: 'video', id: 'missing' }, { track: 'video', id: 'first' }]) {
      const raw = transitionGuidance(tl, selected);
      const hint = { ...raw, title: tOr(t, `app.editor.transition.${raw.id}.title`, raw.title), body: tOr(t, `app.editor.transition.${raw.id}.body`, raw.body), action: raw.action && t('app.editor.workspace.guidance.action') };
      const html = f.render(React.createElement(f.load(base + 'editor/GuidanceCard.js').GuidanceCard, { hint, onAction: noop }));
      assert.ok(html.includes(hint.title)); assert.ok(!html.includes(raw.title));
      assert.ok(html.includes(`aria-label="${hint.title}"`));
    }
  }
});

test('M4/M5/M6: error catalogs cover codes, preserve unknown English and refund honesty', async () => {
  const source = readFileSync('app/veyrnox/_lib/chatApi.js', 'utf8').split('export function chatErrorCopy')[1].split('export function chatUnchargedCopy')[0];
  const codes = [...source.matchAll(/case '([^']+)'/g)].map(match => match[1]);
  for (const { code: locale } of LOCALES) {
    const messages = await appMessagesFor(locale), t = translator(locale, messages);
    for (const code of codes) assert.ok(messages[`app.chat.error.${code}`], `${locale}/${code}`);
    const f = fixture(locale, '/app/chat', { messages, expose: { [base + 'chat/ChatWorkspace.js']: ['errorText'] } });
    const display = f.load(base + 'chat/ChatWorkspace.js').errorText;
    const text = display(t, { code: 'insufficient_balance', extra: { credits: 17 } });
    assert.ok(text.includes('17')); assert.doesNotMatch(text, /\{n\}/);
    if (locale === 'en') assert.equal(text, 'You need 17 Credits for this reply. Top up to continue. Your message was not sent.');
    else assert.doesNotMatch(text, /Your message was not sent/);
    const warning = display(t, { code: 'stop_refunded', before: { code: 'connection_lost' } });
    assert.ok(warning.includes(messages['app.chat.error.stop_refunded']));
    assert.ok(warning.includes(messages['app.chat.error.connection_lost']));
    assert.equal(tOr(t, 'app.publish.autolists.error.future', 'future code'), 'future code');
    assert.equal(tOr(t, 'app.publish.reports.error.future', 'future_code'), 'future_code');
    for (const code of ['feed_timeout','feed_http_error','feed_content_type','unsafe_feed_url','record_failed','schedule_failed','claim_failed']) assert.ok(messages[`app.publish.autolists.error.${code}`]);
  }
});

test('M7: failed pending/refunded jobs render distinct honest wording in every language', async () => {
  const file = base + 'chat/MediaCanvas.js';
  for (const { code: locale } of LOCALES) {
    const messages = await appMessagesFor(locale);
    const f = fixture(locale, '/app/chat', { messages, moduleMocks: { '../JobAssetPreview': { JobAssetPreview: () => null } } });
    for (const refunded of [true, false, undefined]) {
      const job = { state: 'failed', job_id: 'job', refunded };
      const html = f.render(React.createElement(f.load(file).MediaCanvas, { kind: 'video', media: { jobs: [job], clearJobs: noop } }));
      const key = refunded === true ? 'failed' : 'failed_pending', other = refunded === true ? 'failed_pending' : 'failed';
      assert.ok(html.includes(messages[`app.library.status.${key}`]), `${locale}/${refunded}`);
      assert.ok(!html.includes(messages[`app.library.status.${other}`]), `${locale}/${refunded}`);
      if (locale === 'en') assert.ok(html.includes(jobStateUi(job).label));
    }
  }
});

test('M8: German public pricing subscription cards keep the public US-dollar format', async () => {
  const file = base + 'CreditSubscriptions.js';
  const f = fixture('de', '/pricing', { expose: { [file]: ['Plans'] } });
  const html = f.render(React.createElement(f.load(file).Plans, { publicOnly: true, plans: [{ id: 'starter-monthly', price_usd_cents: 1000, credits: 100, billing_interval: 'month' }] }));
  assert.match(html, /\$10/); assert.doesNotMatch(html, /10\s*(?:\$|US\$)/);
});

test('M10: app transport excludes public keys; provider merges public translations on render', async () => {
  const messages = await appMessagesFor('de');
  assert.equal(messages['ui.language'], undefined);
  const before = JSON.stringify({ ...messagesFor('de'), ...messages }), after = JSON.stringify(messages);
  assert.ok(gzipSync(after).length < gzipSync(before).length * .8);
  const f = fixture('de', '/app', { messages });
  const Probe = () => React.createElement('p', null, f.load('components/I18nProvider.jsx').useI18n().t('ui.language'));
  assert.match(f.render(React.createElement(Probe)), /Sprache/);
});

test('M3: helper inventory and dynamic missing families are no longer silently skipped', () => {
  assert.ok(appFiles().includes('app/veyrnox/_lib/editorGuidance.mjs'));
  for (const source of ["export function hint() { return { title: 'Uncatalogued helper title', body: 'Uncatalogued helper body' }; }", "export function error() { return 'Uncatalogued helper error'; }"]) {
    assert.ok(candidates('lib/example.js', source, { app: true }).some(row => row.status === 'unresolved'));
  }
  assert.ok(candidates('components/Example.js', 'const value = tOr(t, `missing.family.${code}`, "Uncatalogued fallback");', { app: true }).some(row => row.status === 'unresolved'));
});

test('M9: app/public boundary navigation rebuilds the document in both directions', () => {
  const originalDocument = globalThis.document, originalWindow = globalThis.window;
  let listener;
  const navigations = [];
  try {
    globalThis.document = { addEventListener(name, callback, capture) { assert.equal(name, 'click'); assert.equal(capture, true); listener = callback; }, removeEventListener: noop };
    globalThis.window = { location: { href: 'https://veyrnox.test/app', pathname: '/app', origin: 'https://veyrnox.test', assign: href => navigations.push(href) } };
    const f = fixture('ar', '/app', { moduleMocks: { react: { ...hooks, useEffect: effect => effect(), useMemo: fn => fn() } } });
    f.load('components/I18nProvider.jsx').I18nProvider({ locale: 'ar', enabled: true });
    const click = (href, modifiers = {}) => {
      let prevented = false;
      const anchor = { href, target: '', hasAttribute: () => false };
      listener({ button: 0, target: { closest: () => anchor }, preventDefault: () => { prevented = true; }, ...modifiers });
      return prevented;
    };
    assert.equal(click('https://veyrnox.test/legal/privacy'), true);
    assert.equal(click('https://veyrnox.test/de/pricing?offer=1#packs'), true);
    assert.equal(click('https://veyrnox.test/app/library'), false);
    window.location.pathname = '/de/pricing';
    assert.equal(click('https://veyrnox.test/app?intent=create'), true);
    assert.equal(click('https://veyrnox.test/fr/pricing'), false);
    assert.equal(click('https://veyrnox.test/app', { ctrlKey: true }), false);
    assert.deepEqual(navigations, ['https://veyrnox.test/legal/privacy', 'https://veyrnox.test/de/pricing?offer=1#packs', 'https://veyrnox.test/app?intent=create']);
  } finally { globalThis.document = originalDocument; globalThis.window = originalWindow; }
});

test('M1: assistant targets no longer use localized labels or placeholders', () => {
  const source = readFileSync('lib/productHelp.js', 'utf8');
  assert.doesNotMatch(source, /selector: '[^']*\[(?:aria-label|placeholder)=/);
  for (const [id, file] of [
    ['film.stages', 'film/FilmWorkspace.js'], ['chat.settings', 'chat/SettingsPanel.js'], ['chat.threads', 'chat/ThreadList.js'], ['chat.skills', 'chat/SkillsPanel.js'],
  ]) assert.ok(readFileSync(base + file, 'utf8').includes(`data-assistant-target="${id}"`));
});

test('L11: built-in folder and attribution labels translate without changing project values', async () => {
  const { storedFolderLabel, storedAttributionLabel, PROCESSED_FOLDER, ORIGINAL_CREDIT, ORIGINAL_USAGE, originalFolder } = await import('../app/veyrnox/_lib/editorStoredLabels.mjs');
  for (const locale of ['de', 'ja']) {
    const t = translator(locale, await appMessagesFor(locale));
    assert.equal(PROCESSED_FOLDER, 'Processed video');
    assert.equal(originalFolder('music'), 'Original audio/music');
    assert.notEqual(storedFolderLabel(t, PROCESSED_FOLDER), PROCESSED_FOLDER);
    assert.notEqual(storedAttributionLabel(t, ORIGINAL_CREDIT), ORIGINAL_CREDIT);
    assert.notEqual(storedAttributionLabel(t, ORIGINAL_USAGE), ORIGINAL_USAGE);
    assert.equal(storedFolderLabel(t, 'User folder'), 'User folder');
  }
});

test('L4/L6/L12: role coverage, one-time effects and benefits remain stable', async () => {
  for (const { code } of LOCALES) {
    const messages = await appMessagesFor(code);
    for (const role of ['analyst', 'viewer']) assert.ok(messages[`app.publish.role.${role}`]);
    for (const id of ['multitrack', 'local', 'cloud', 'no_card']) assert.ok(messages[`app.editor.credits.benefit.${id}`]);
  }
  for (const file of ['app/veyrnox/app/create/page.js', base + 'OddlingStudio.js', base + 'TopUpPacks.js', base + 'CreditSubscriptions.js']) {
    const source = readFileSync(file, 'utf8');
    assert.ok(source.includes('translation.current'));
    assert.doesNotMatch(source, /\[account, recovery, recover, t\]|\[signedIn, t\]|\}, \[t\]\);/);
  }
});
