import { fixture } from './helpers/publicSiteRender.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { candidates, publicFiles } from '../scripts/audit-public-i18n.mjs';
import { HELP_TARGETS, HELP_ACTIONS, helpStartersForPath } from '../lib/productHelp.js';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, translator } from '../lib/i18n/translate.mjs';
import { LOCALES, isLocalizedPath, localizedHref, languageAlternates, splitLocalePath } from '../lib/i18n/locales.mjs';
import { SITE_PAGES, PRESETS } from '../app/veyrnox/_lib/tokens.js';
import { isUnknownStaticPage } from '../lib/unknownStaticPage.js';
import { editorialSeries } from '../app/veyrnox/social-cinema/editorialSeries.js';
import { MAGIC_VERIFIER_TTL_MS } from '../app/lib/pkceVerifier.js';

const paths = ['/social-cinema', '/social-cinema/creator', '/social-cinema/pass', '/social-cinema/title/example', '/social-cinema/watch/example', '/presets/example', '/social-cinema/series/example', '/m', '/m/create', '/m/credits', '/m/explore', '/m/job', '/m/library', '/oauth/consent', '/auth/callback', '/social/review/example-token', '/social/team/invite/example-token', '/social/connect/callback/facebook'];
test('phase A translated routes retain language, query and alternates', () => {
  for (const route of paths) {
    assert.ok(isLocalizedPath(route), route);
    assert.equal(languageAlternates(route)['x-default'], route);
    for (const language of LOCALES) {
      const expected = language.code === 'en' ? route : `/${language.code}${route}`;
      assert.equal(localizedHref(language.code, `${route}?test=1#section`), `${expected}?test=1#section`);
      assert.equal(languageAlternates(route)[language.hreflang], expected);
      if (language.code !== 'en') assert.equal(splitLocalePath(expected).rest, route);
    }
  }
  for (const route of ['/app/create', '/legal/privacy', '/design-system', '/s/example', '/xx/m', '/m/unknown']) assert.equal(isLocalizedPath(route), false, route);
});

test('new key families, permission ceilings, TTL and sample units survive every translation', () => {
  for (const language of LOCALES) {
    const m = CATALOGS[language.code], t = translator(language.code);
    for (const family of ['cinema.series.', 'mobile.', 'oauth.', 'social.', 'callback.', 'privacy.', 'recovery.', 'search.page.']) {
      assert.ok(Object.keys(m).some(key => key.startsWith(family)), `${language.code}: ${family}`);
    }
    assert.match(m['oauth.limit'], /\b2\b/, language.code);
    assert.match(m['mobile.recommended'], /WAN 2\.5/, language.code);
    assert.match(m['mobile.queued'], /0:02/, language.code);
    assert.match(m['mobile.renderTime'], /0:18/, language.code);
    assert.match(t('callback.notStarted', { minutes: MAGIC_VERIFIER_TTL_MS / 60000 }), new RegExp(String(MAGIC_VERIFIER_TTL_MS / 60000)), language.code);
    for (const role of ['manager', 'editor', 'reviewer', 'analyst', 'viewer']) assert.ok(m[`social.role.${role}`]);
    for (const status of ['pending', 'approved', 'rejected', 'canceled', 'accepted', 'revoked', 'expired']) assert.ok(m[`social.status.${status}`]);
    for (const resource of ['Page', 'board', 'location', 'destination']) assert.ok(m[`social.resource.${resource}`]);
    for (const page of SITE_PAGES) {
      assert.ok(m[`label.${page.label}`], page.label);
      const key = `search.page.${page.href === '/' ? 'home' : page.href.slice(1).replaceAll('/', '-')}`;
      assert.ok(m[key], key);
      if (language.code === 'en') assert.equal(m[key], page.description);
    }
    for (const preset of PRESETS) assert.ok(m[`presets.cat.${preset.category}`], preset.category);
  }
});

const root = path.resolve(import.meta.dirname, '..');

test('offline SSR: Japanese mobile redirect and creation UI; Arabic credits and RTL spacing', async () => {
  const saved = process.env.LOCALES_ENABLED;
  process.env.LOCALES_ENABLED = 'true';
  try {
    const ja = fixture('ja', '/m/create');
    await assert.rejects(ja.load('app/veyrnox/m/page.js').default(), /redirect:\/ja\/m\/create/);
    const html = ja.render(React.createElement(ja.load('app/veyrnox/m/create/page.js').default));
    assert.ok(html.includes(CATALOGS.ja['mobile.generate']));
    assert.ok(html.includes('/ja/m/job'));
    assert.doesNotMatch(html, />Create<|>Generate<|RECOMMENDED|REFUND ON FAILURE/);
    const ar = fixture('ar', '/m/credits');
    const credits = ar.render(React.createElement(ar.load('app/veyrnox/m/credits/page.js').default));
    assert.ok(credits.includes(CATALOGS.ar['mobile.balance']));
    assert.ok(credits.includes(CATALOGS.ar['mobile.balanceNote']));
    assert.ok(credits.includes('ms-1.5'));
    assert.doesNotMatch(credits, /CURRENT BALANCE|NO TIERS|>Top up</);
  } finally { if (saved === undefined) delete process.env.LOCALES_ENABLED; else process.env.LOCALES_ENABLED = saved; }
});

test('offline SSR: Korean consent renders invalid and authenticated permission states', () => {
  const ko = fixture('ko', '/oauth/consent');
  const Consent = ko.load('app/veyrnox/oauth/consent/OAuthConsent.js').OAuthConsent;
  const invalid = ko.render(React.createElement(Consent, { authorizationId: '' }));
  assert.ok(invalid.includes(CATALOGS.ko['oauth.invalid']));
  const ready = fixture('ko', '/oauth/consent', { consentReady: true });
  const html = ready.render(React.createElement(ready.load('app/veyrnox/oauth/consent/OAuthConsent.js').OAuthConsent, { authorizationId: 'test', publishOpen: true }));
  for (const key of ['oauth.limit', 'oauth.publishAccess', 'oauth.restrictionsPublish', 'oauth.approve']) assert.ok(html.includes(CATALOGS.ko[key]), key);
  assert.doesNotMatch(html, /Requested access|Approve connection|Technical details/);
});

test('unknown Cinema series uses the existing hard-404 middleware guard', () => {
  assert.equal(isUnknownStaticPage('/social-cinema/series/not-a-series'), true);
  assert.equal(isUnknownStaticPage('/veyrnox/social-cinema/series/not-a-series'), true);
  for (const series of editorialSeries) assert.equal(isUnknownStaticPage(`/social-cinema/series/${series.slug}`), false);
});

test('offline SSR: German editorial series keeps catalog data and translates episode chrome', async () => {
  const saved = process.env.LOCALES_ENABLED;
  process.env.LOCALES_ENABLED = 'true';
  try {
    const series = editorialSeries[0], route = `/social-cinema/series/${series.slug}`;
    const de = fixture('de', route);
    const page = de.load('app/veyrnox/social-cinema/series/[slug]/page.js');
    const html = de.render(await page.default({ params: Promise.resolve({ slug: series.slug }) }));
    assert.ok(html.includes(series.title));
    assert.ok(html.includes(CATALOGS.de['cinema.series.episodes']));
    assert.ok(html.includes(CATALOGS.de['cinema.series.playFirst']));
    assert.doesNotMatch(html, /poster frame|Watch episode|>Episodes</);
    const meta = await page.generateMetadata({ params: Promise.resolve({ slug: series.slug }) });
    assert.equal(meta.alternates.canonical, `/de${route}`);
    assert.equal(meta.alternates.languages.ja, `/ja${route}`);
  } finally { if (saved === undefined) delete process.env.LOCALES_ENABLED; else process.env.LOCALES_ENABLED = saved; }
});

test('Cinema, OAuth, auth and template families and policy quantities survive all ten translations', () => {
  const families = ['oauth.', 'social.', 'cinema.comments.', 'cinema.discovery.', 'cinema.retention.', 'cinema.share.', 'cinema.storyPolls.', 'cinema.voting.', 'cinema.winners.', 'cinema.creatorApplication.', 'cinema.socialCinema.', 'cinema.creatorAnalytics.', 'cinema.creatorWorkspace.', 'cinema.videoUpload.', 'cinema.passPanel.', 'cinema.titlePage.', 'cinema.player.', 'authGate.', 'presets.detail.', 'presets.use.', 'public.library.', 'public.vey.', 'public.subscription.', 'public.jobs.', 'mcp.pub.'];
  const numbers = text => text.match(/\d+(?:[,.]\d+)*(?:%|\+)?/g) || [];
  const policySamples = {
    'oauth.limit': ['2'],
    'authGate.newUsersGet10FreeCredits': ['10'],
    'cinema.passPanel.aCinemaPassUnlocksEveryPublished': ['1,500'],
    'cinema.creatorAnalytics.completionMeansAtLeast90Of': ['90%'],
    'cinema.winners.votesCountFor40Completion25': ['40%', '25%', '15%', '10%', '10%'],
    'cinema.creatorWorkspace.withdrawThisTitleFromSocialCinema': ['30'],
    'cinema.videoUpload.upTo2GibAnd10': ['2', '10'],
    'mcp.tool.publish_list_posts': ['43'],
    'mcp.tool.publish_schedule_post': ['10'],
  };
  for (const { code } of LOCALES) {
    for (const [key, expected] of Object.entries(policySamples)) assert.deepEqual(numbers(CATALOGS[code][key]), expected, `${code} ${key}`);
    for (const prefix of families) assert.ok(Object.keys(CATALOGS[code]).some(k => k.startsWith(prefix)), `${code} ${prefix}`);
    for (const [key, english] of Object.entries(CATALOGS.en)) {
      if (!/^(cinema\.|oauth\.|social\.|mobile\.|privacy\.|callback\.|authGate\.|presets\.(use|detail)\.|mcp\.(pub\.|tool\.publish_)|public\.(subscription|jobs|vey)\.)/.test(key) || !numbers(english).length) continue;
      assert.deepEqual(numbers(CATALOGS[code][key]).sort(), numbers(english).sort(), `${code} ${key}`);
    }
    for (const key of ['cinema.creator.reviewPolicy', 'cinema.pass.continues', 'presets.use.refunds']) {
      assert.ok(CATALOGS[code][key]);
      if (code !== 'en') assert.notEqual(CATALOGS[code][key], CATALOGS.en[key], `${code} ${key}`);
    }
  }
});

test('offline SSR: public Cinema and template routes render translated UI and alternates', async () => {
  const previous = process.env.LOCALES_ENABLED;
  process.env.LOCALES_ENABLED = 'true';
  try {
    const de = fixture('de', '/social-cinema');
    for (const [file, props, expected] of [
      ['app/veyrnox/social-cinema/page.js', {}, 'cinema.socialCinema.originalEpisodesOngoingSeriesAnAudience'],
      ['app/veyrnox/social-cinema/creator/page.js', {}, 'cinema.creatorWorkspace.theCreatorWorkspaceIsInPreview'],
      ['app/veyrnox/social-cinema/pass/page.js', {}, 'cinema.passPanel.everyStoryOnePass'],
      ['app/veyrnox/social-cinema/title/[id]/page.js', { params: Promise.resolve({ id: 'missing' }) }, 'cinema.titlePage.loading'],
      ['app/veyrnox/social-cinema/watch/[id]/page.js', { params: Promise.resolve({ id: 'missing' }), searchParams: Promise.resolve({}) }, 'cinema.player.preparingPlayback'],
    ]) {
      const page = de.load(file);
      const html = de.render(await page.default(props));
      assert.ok(html.includes(CATALOGS.de[expected]), `${file}: ${expected}`);
      assert.doesNotMatch(html, /Stories worth|Loading competitions|Preparing playback|Your audience|Every story, one Pass/);
      const meta = await page.generateMetadata(props);
      assert.match(meta.alternates.canonical, /^\/de\/social-cinema/);
      assert.ok(meta.alternates.languages.ja);
      if (!file.endsWith('/social-cinema/page.js')) assert.equal(meta.robots.index, false);
    }
    const preset = PRESETS[0], template = de.load('app/veyrnox/presets/[id]/page.js');
    const html = de.render(await template.default({ params: Promise.resolve({ id: preset.id }) }));
    assert.ok(html.includes(CATALOGS.de['presets.use.cost']));
    assert.ok(html.includes('/de/presets'));
    assert.doesNotMatch(html, /Runs on|You add:|>Copy prompt<|>Use this template<|Need a longer video/);
    assert.equal((await template.generateMetadata({ params: Promise.resolve({ id: preset.id }) })).alternates.canonical, `/de/presets/${preset.id}`);
  } finally { if (previous === undefined) delete process.env.LOCALES_ENABLED; else process.env.LOCALES_ENABLED = previous; }
});

test('offline SSR: authenticated public controls and Arabic sign-in dialog use catalog copy', () => {
  const authFile = 'components/AuthGate.jsx';
  const ar = fixture('ar', '/', { states: { [authFile]: [true] } });
  const modal = ar.render(React.createElement(ar.load(authFile).default));
  assert.ok(modal.includes('dir="rtl"'));
  assert.ok(modal.includes(CATALOGS.ar['authGate.newUsersGet10FreeCredits']));
  assert.doesNotMatch(modal, /Create your account|New users get|Continue with|Show password/);
  const scenarios = [
    ['CinemaComments.js', 'CinemaComments', [ { comments: [], own_comments: [] }, '', '', false, false, '', '' ], { contentId: 'test' }],
    ['CinemaVoting.js', 'CinemaVoting', [ { competitions: [{ id: 'c', name: 'Catalog name', qualified_votes: 2, ends_at: '2026-10-18' }] }, '', false, '', '' ], { contentId: 'test' }],
    ['CinemaStoryPolls.js', 'CinemaStoryPolls', [ { polls: [{ id: 'p', question: 'User question', is_open: true, closes_at: '2026-10-18', options: [{ id: 'a', label: 'User answer', votes: 3 }] }] }, '', false, '', '', {} ], { contentId: 'test' }],
    ['CinemaShare.js', 'CinemaShare', [], { id: '12345678-1234-1234-1234-123456789abc', title: 'Catalog title' }],
    ['creator/CreatorWorkspace.js', 'SubmitForReview', [], { item: { id: 'test', title: 'Catalog title', content_type: 'FILM' } }],
    ['creator/VideoUpload.js', 'VideoUpload', [], { content: { id: 'test', title: 'Catalog title' } }],
    ['pass/PassPanel.js', 'Pass', [[{ id: 'p', billing_interval: 'month', price_usd_cents: 500, intro_price_usd_cents: 200 }], 'version', null, '', false, true, false], { salesOpen: true }],
  ];
  for (const [name, component, states, props] of scenarios) {
    const file = `app/veyrnox/social-cinema/${name}`;
    const f = fixture('de', '/social-cinema', { states: { [file]: states }, signedIn: true, preview: true, expose: component === 'Pass' || component === 'SubmitForReview' ? { [file]: [component] } : {} });
    const html = f.render(React.createElement(f.load(file)[component], props));
    assert.doesNotMatch(html, /cinema\.[a-zA-Z]+\.|Submit for review|Community voting|Story choices|Video for|Start monthly Pass/, name);
  }
});


test('offline SSR: opening new project, season and episode drafts renders German and Arabic type selects', () => {
  const file = 'app/veyrnox/social-cinema/creator/CreatorWorkspace.js';
  function findButton(node, label) {
    if (!React.isValidElement(node)) return null;
    if (node.props.onClick && node.props.children === label) return node;
    return React.Children.toArray(node.props.children).map(child => findButton(child, label)).find(Boolean);
  }
  for (const locale of ['de', 'ar']) {
    const t = translator(locale);
    for (const parent of [null, { id: 'series', content_type: 'SERIES' }, { id: 'season', content_type: 'SEASON' }]) {
      const types = parent ? [parent.content_type === 'SERIES' ? 'SEASON' : 'EPISODE'] : ['SERIES', 'FILM', 'SHORT', 'TRAILER'];
      const typeLabel = type => t(type === 'SERIES' ? 'cinema.socialCinema.series' : `cinema.creatorWorkspace.${type.toLowerCase()}`);
      const f = fixture(locale, '/social-cinema/creator', {
        states: { [file]: [parent ? [parent] : [], [], 'ready', '', 0, null, '', null, null] },
        expose: { [file]: ['Drafts'] },
      });
      const { Drafts } = f.load(file);
      let clicked = false;
      function OpenNewDraft() {
        const [opened, setOpened] = React.useState(false);
        const tree = Drafts({ proxyUploadsEnabled: false });
        if (!opened) {
          const label = parent ? t('cinema.creator.newType', { type: typeLabel(types[0]) }) : t('cinema.creator.newProject');
          const button = findButton(tree, label);
          assert.ok(button, `${locale}: ${label}`);
          // Invoke the actual New button handler. React applies its state updates
          // and renders the real DraftEditor, including the !draft.id branch.
          button.props.onClick();
          clicked = true;
          setOpened(true);
        }
        return tree;
      }
      const html = f.render(React.createElement(OpenNewDraft));
      assert.ok(clicked);
      assert.match(html, /<select id="draft-type" name="content_type"/);
      for (const type of types) assert.ok(html.includes(`>${typeLabel(type)}</option>`), `${locale}: ${type}`);
      assert.ok(html.includes(t('cinema.creatorWorkspace.newDraft')));
      assert.doesNotMatch(html, /cinema\.[a-zA-Z]+\.|>New draft<|>Type</);
    }
  }
});

test('offline SSR: unknown social roles and statuses retain server values; known values translate', () => {
  for (const locale of ['de', 'ar']) {
    const t = translator(locale);
    const inviteFile = 'app/social/team/invite/[token]/page.js';
    for (const [role, status, accepted] of [['custom-role', 'custom-status', false], ['custom-role', 'accepted', true], ['reviewer', 'expired', false]]) {
      const invite = { brand_name: 'Test brand', email: 'test@example.com', expires_at: '2026-10-18T12:00:00Z', role, status };
      const f = fixture(locale, '/social/team/invite/test', { states: { [inviteFile]: [invite, false, accepted, ''] } });
      const html = f.render(React.createElement(f.load(inviteFile).default));
      assert.ok(html.includes(role === 'reviewer' ? t('social.role.reviewer') : role));
      if (!accepted) assert.ok(html.includes(status === 'expired' ? t('social.status.expired') : status));
      assert.doesNotMatch(html, /social\.(role|status)\./);
    }
    const reviewFile = 'app/social/review/[token]/page.js';
    for (const [decision, status] of [['custom-decision', 'custom-status'], ['approved', 'canceled']]) {
      const review = { brand_name: 'Test brand', scheduled_at: '2026-10-18T12:00:00Z', decision, request_status: status };
      const f = fixture(locale, '/social/review/test', { states: { [reviewFile]: [review, '', '', ''] } });
      const html = f.render(React.createElement(f.load(reviewFile).default));
      for (const value of [decision, status]) assert.ok(html.includes(value.startsWith('custom-') ? value : t(`social.status.${value}`)));
      assert.doesNotMatch(html, /social\.status\./);
    }
  }
});

test('new credit, library and preset copy uses the established catalog terminology', () => {
  const terms = {
    es: [/crédit/i, /biblioteca/i, /ajustes preestablecidos/i],
    zh: [/积分/, /素材库/, /预设/],
    hi: [/क्रेडिट/, /लाइब्रेरी/, /प्रीसेट/],
    ar: [/كريدت/, /مكتب/, /الإعدادات الجاهزة/],
    fr: [/crédit/i, /biblioth/i, /prérégl/i],
    pt: [/crédit/i, /biblioteca/i, /predefini/i],
    ru: [/кредит/i, /библиот/i, /пресет/i],
    ja: [/クレジット/, /ライブラリ/, /プリセット/],
    de: [/Credit/, /Bibliothek/i, /Preset/i],
    ko: [/크레딧/, /라이브러리/, /프리셋/],
  };
  for (const [locale, [credit, library, preset]] of Object.entries(terms)) {
    const m = CATALOGS[locale];
    for (const key of ['oauth.limit', 'cinema.title.balance', 'authGate.newUsersGet10FreeCredits', 'search.page.pricing']) assert.match(m[key], credit, `${locale} ${key}`);
    for (const key of ['label.Library', 'cinema.videoUpload.fromLibrary', 'public.library.label']) assert.match(m[key], library, `${locale} ${key}`);
    assert.match(m['label.Preset gallery'], preset, locale);
  }
});

test('public copy audit classifies every literal; it rejects new untranslated UI', () => {
  const rows = publicFiles().flatMap(file => candidates(file, readFileSync(path.join(root, file), 'utf8')));
  assert.deepEqual(rows.filter(row => row.status === 'unresolved'), []);
  for (const row of rows.filter(row => row.status === 'allowlisted')) assert.ok(row.reason);
  const probe = candidates('app/veyrnox/example/page.js', `<button title="English title">Untranslated button {ok ? 'Retry' : 'Continue'}</button>`);
  assert.equal(probe.filter(row => row.status === 'unresolved').length, 4);
});

test('public helper questions, destination labels and actions have every translation', () => {
  for (const { code } of LOCALES) {
    const m = CATALOGS[code];
    for (const { label } of Object.values(HELP_TARGETS)) assert.ok(m[`label.${label}`], `${code}: ${label}`);
    for (const action of Object.keys(HELP_ACTIONS)) assert.ok(m[`public.vey.action.${action}`]);
    for (const route of ['/', '/models', '/presets', '/tools', '/mcp', '/developers', '/pricing', '/social-cinema', '/oddlings']) {
      for (const question of helpStartersForPath(route)) assert.ok(m[`public.vey.question.${question}`], `${code}: ${question}`);
    }
  }
});

test('offline SSR: shared helper, clipboard, account and subscription controls translate', () => {
  const f = fixture('ja', '/pricing');
  const Copy = f.load('app/veyrnox/_components/CopyButton.js').CopyButton;
  assert.ok(f.render(React.createElement(Copy, { value: 'model-id' })).includes(CATALOGS.ja['common.copy']));
  const conversation = f.load('app/veyrnox/_components/VeyConversation.jsx').default;
  const html = f.render(React.createElement(conversation, { messages: [], answer: 'Vey', starters: helpStartersForPath('/pricing') }));
  assert.ok(html.includes(CATALOGS.ja['public.vey.examples']));
  assert.doesNotMatch(html, /How do Credits work|Do purchased Credits expire/);
  const file = 'app/veyrnox/_components/CreditSubscriptions.js';
  const offer = fixture('de', '/pricing', { states: { [file]: [{ phase: 'open', catalog: { plans: [{ id: 'starter-weekly', billing_interval: 'week', price_usd_cents: 500, credits: 100 }] } }] } });
  const markup = offer.render(React.createElement(offer.load(file).CreditSubscriptionOffer));
  assert.ok(markup.includes(CATALOGS.de['public.subscription.expiry']));
  assert.doesNotMatch(markup, /each paid|do not roll over|renew automatically|Refresh prices/);
});


test('offline SSR: embedded YouTube controls request the site language', () => {
  const series = editorialSeries[0], episode = series.episodes[0];
  const file = 'app/veyrnox/social-cinema/watch/[id]/Player.js';
  for (const [locale, hl] of [['de', 'de'], ['zh', 'zh-CN'], ['pt', 'pt-BR'], ['ar', 'ar']]) {
    const f = fixture(locale, `/social-cinema/watch/${episode.id}`, { states: { [file]: ['external'] } });
    const html = f.render(React.createElement(f.load(file).Player, { id: episode.id, seriesSlug: series.slug }));
    const url = new URL(html.match(/<iframe[^>]*src="([^"]+)"/)[1].replaceAll('&amp;', '&'));
    assert.equal(url.hostname, 'www.youtube-nocookie.com');
    assert.equal(url.searchParams.get('hl'), hl);
    assert.equal(url.searchParams.getAll('hl').length, 1);
    assert.ok(html.includes(CATALOGS[locale]['cinema.player.rights'].split('{creator}')[0]));
  }
});

test('offline SSR: persisted app journeys have translated guidance on public pages', () => {
  const file = 'app/veyrnox/_components/VeyTaskGuide.jsx';
  const cases = [
    ['return', { phase: 'image', reviewed: {} }, {}],
    ['recover', { phase: 'image', imageJob: 'j' }, {}],
    ['failed', { phase: 'image', imageJob: 'j' }, { jobs: [{ job_id: 'j', state: 'failed' }] }],
    ['waiting', { phase: 'image', imageJob: 'j' }, { jobs: [{ job_id: 'j', state: 'running' }] }],
    ['imageReady', { phase: 'image', imageJob: 'j' }, { jobs: [{ job_id: 'j', state: 'succeeded' }] }],
    ['complete', { phase: 'video', videoJob: 'j' }, { jobs: [{ job_id: 'j', state: 'succeeded' }] }],
  ];
  for (const [key, task, view] of cases) {
    const f = fixture('de', '/', { states: { [file]: [] }, journey: { task, view } });
    const html = f.render(React.createElement(f.load(file).default, { visible: true, pathname: '/', onActiveChange() {}, onPoint() {}, onStop() {} }));
    assert.ok(html.includes(CATALOGS.de[`public.vey.step.${key}.title`]), key);
    assert.ok(html.includes(CATALOGS.de[`public.vey.step.${key}.message`]), key);
  }
});


test('global error recovers Arabic without the failed root provider and rejects unknown prefixes', () => {
  const file = 'app/global-error.js', previous = globalThis.window;
  try {
    for (const [route, locale] of [['/ar/social-cinema', 'ar'], ['/xx/social-cinema', 'en'], ['/ar/app', 'en']]) {
      globalThis.window = { location: { pathname: route } };
      const f = fixture(locale, route, { states: { [file]: [] } });
      const html = renderToStaticMarkup(React.createElement(f.load(file).default, { retry() {} }));
      assert.ok(html.includes(CATALOGS[locale]['recovery.pageUnavailable']), `${route}: ${html}`);
      assert.ok(html.includes(`dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`));
      assert.ok(html.includes(CATALOGS[locale]['recovery.body']));
    }
  } finally { globalThis.window = previous; }
});


test('offline SSR: version-bound legal declarations remain exact English inside translated forms', () => {
  const pass = 'Start my Cinema Pass now. I understand it renews automatically until I cancel, and that if I cancel within 14 days I get back the unused share of what I paid.';
  const unlock = 'Unlock now and add it to my account for good. I understand this spends credits straight away and that my right to cancel ends once I press play.';
  const rights = 'I own or hold the rights to everything in this title, including any real people, voices, music and footage, and I have declared its AI use truthfully.';
  const safety = 'This title contains no nudity, pornography, explicit sexual content, sexualised minors, non-consensual intimate imagery, sexual violence, or sexual deepfake of a real person. I have read the Cinema Content Policy.';
  const malware = 'I have not intentionally included malware, executable code, disguised files or links intended to compromise viewers or Veyrnox.';
  const title = { id: '12345678-1234-1234-1234-123456789abc', title: 'Catalog title', content_type: 'FILM', access: 'locked', credits: 5, duration_seconds: 120, ai_disclosures: ['generated_video'] };
  for (const locale of ['de', 'ar']) {
    for (const [file, component, states, props, legal] of [
      ['creator/CreatorWorkspace.js', 'SubmitForReview', [], { item: title }, [rights, safety, malware]],
      ['pass/PassPanel.js', 'Pass', [[{ id: 'p', billing_interval: 'month', price_usd_cents: 500 }], 'version', null, '', false, true, false], { salesOpen: true }, [pass]],
      ['title/[id]/TitlePage.js', 'TitlePage', [title, 'ready', 'version', false, '', ''], { id: title.id }, [unlock]],
    ]) {
      const name = `app/veyrnox/social-cinema/${file}`;
      const f = fixture(locale, '/social-cinema', { signedIn: true, states: { [name]: states }, expose: component === 'TitlePage' ? {} : { [name]: [component] } });
      const html = f.render(React.createElement(f.load(name)[component], props));
      const statements = [...html.matchAll(/<span lang="en" dir="ltr">([\s\S]*?)<\/span>/g)].map(match => match[1].replace(/<[^>]+>/g, ''));
      assert.deepEqual(statements, legal, `${locale} ${component}`);
      assert.ok(html.includes(CATALOGS[locale][component === 'Pass' ? 'cinema.passPanel.chooseAPass' : component === 'TitlePage' ? 'label.Cinema Pass' : 'cinema.comments.submitForReview']));
      if (component === 'TitlePage') {
        assert.ok(html.includes(translator(locale)('cinema.duration', { n: 2 })));
        assert.ok(html.includes(translator(locale)('cinema.title.aiDisclosures', { disclosures: CATALOGS[locale]['cinema.disclosure.generated_video'] })));
      }
    }
  }
  for (const m of Object.values(CATALOGS)) for (const key of ['cinema.passPanel.startMyCinemaPassNowI', 'cinema.titlePage.unlockNowAndAddItTo', 'cinema.creatorWorkspace.iOwnOrHoldTheRights', 'cinema.creator.safetyPolicy', 'cinema.creatorWorkspace.iHaveNotIntentionallyIncludedMalware']) assert.equal(m[key], undefined);
  assert.match(readFileSync(path.join(root, 'app/veyrnox/social-cinema/creator/CreatorWorkspace.js'), 'utf8'), /RIGHTS_VERSION = 'rights-2026-10-13'/);
});

test('offline SSR: library caller labels and saved-choice dates follow the page locale', () => {
  for (const locale of ['de', 'ar']) {
    const f = fixture(locale, '/social-cinema/creator'), t = translator(locale);
    const picker = f.load('app/veyrnox/_components/LibraryPicker.js').LibraryPicker;
    const html = f.render(React.createElement(picker, { sourceLabel: 'Start frame' }));
    assert.ok(html.includes(t('public.library.choose', { type: t.label('Start frame') })));
    assert.doesNotMatch(html, /Start frame/);
    const savedAt = Date.UTC(2026, 9, 18, 14, 25);
    const conversation = f.load('app/veyrnox/_components/VeyConversation.jsx').default;
    const choices = f.render(React.createElement(conversation, { messages: [], plan: { savedChoices: [{ id: 'p', name: 'User name', savedAt }] } }));
    assert.ok(choices.includes(new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(savedAt)));
  }
  for (const locale of ['ja', 'hi']) assert.equal(CATALOGS[locale]['label.Generate'], CATALOGS[locale]['mobile.generate']);
});

test('offline SSR: unknown Cinema categories, types, disclosures and billing intervals preserve server text', () => {
  const title = { id: '12345678-1234-1234-1234-123456789abc', title: 'Catalog title', content_type: 'FUTURE_TYPE', access: 'free', categories: ['future-category'], ai_disclosures: ['future_disclosure'], competitions: [] };
  for (const locale of ['en', 'ar']) {
    for (const [file, component, states, props, expected] of [
      ['CinemaDiscovery.js', 'Inventory', [[title], [{ slug: 'future-category', label: 'Server category label' }], '', 'ready'], { mode: 'all' }, ['Server category label', 'FUTURE_TYPE']],
      ['title/[id]/TitlePage.js', 'TitlePage', [title, 'ready'], { id: title.id }, ['future-category', 'future_disclosure', 'FUTURE_TYPE']],
      ['pass/PassPanel.js', 'Pass', [[{ id: 'p', billing_interval: 'fortnight', price_usd_cents: 500 }], 'version', null, '', false, false, false], { salesOpen: true }, ['fortnight']],
    ]) {
      const name = `app/veyrnox/social-cinema/${file}`;
      const f = fixture(locale, '/social-cinema', { states: { [name]: states }, expose: component === 'TitlePage' ? {} : { [name]: [component] } });
      const html = f.render(React.createElement(f.load(name)[component], props));
      for (const value of expected) assert.ok(html.includes(value), `${locale}: ${component}: ${value}`);
      assert.doesNotMatch(html, /cinema\.(category|type|disclosure|pass)\.[A-Za-z_-]+/);
    }
  }
});

test('offline SSR: Vey logical corners and move-panel labels follow en/ar direction', () => {
  const file = 'app/veyrnox/_components/VeyTaskGuide.jsx';
  for (const locale of ['en', 'ar']) {
    for (const side of ['left', 'right']) {
      const f = fixture(locale, '/', { states: { [file]: [true] } });
      const Guide = f.load(file).default;
      const html = f.render(React.createElement(Guide, { visible: true, pathname: '/', panelSide: side }));
      assert.ok(html.includes(side === 'left' ? 'start-2 sm:start-3' : 'end-2 sm:end-3'));
      const movesRight = (side === 'left') !== (locale === 'ar');
      assert.ok(html.includes(CATALOGS[locale][movesRight ? 'public.vey.panelsRight' : 'public.vey.panelsLeft']));
      assert.ok(html.includes('data-vey-walkthrough="true"'));
      assert.doesNotMatch(html, /(?:left|right)-[234]/);
    }
  }
});

test('search model kinds keep known translations and unknown server values in en/ar', () => {
  const file = 'app/veyrnox/_components/SiteSearch.js';
  for (const locale of ['en', 'ar']) {
    const f = fixture(locale, '/', { expose: { [file]: ['modelsToIndex'] } }), t = translator(locale);
    const index = f.load(file).modelsToIndex(['image', 'future-kind'].map(kind => ({ id: kind, name: kind, kind, credits: 1 })), t);
    assert.ok(index[0].detail.includes(t('home.models.image')));
    assert.ok(index[1].detail.includes('future-kind'));
    assert.doesNotMatch(index.map(item => item.detail).join(' '), /(?:model.mode|home.models)\./);
  }
});
