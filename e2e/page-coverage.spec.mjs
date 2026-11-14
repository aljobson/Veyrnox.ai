import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildPageManifest, sitemapPaths } from './page-manifest.mjs';

async function handlePrivacyChoices(page) {
  // Consent hydrates after the document loads; handle it at actionability time,
  // within the original action timeout, using the normal essential-only choice.
  // Both notices are fixed to the bottom edge: PostHogManager's analytics choice,
  // and SiteChrome's essential-only notice shown when analytics is not configured.
  for (const [notice, control] of [
    ['[data-storage-notice="analytics"]', '[data-storage-decline]'],
    ['[data-storage-notice="essential"]', '[data-storage-dismiss]'],
  ]) {
    const privacyChoices = page.locator(notice);
    await page.addLocatorHandler(privacyChoices, async () => {
      await privacyChoices.locator(control).click();
      await expect(privacyChoices).toBeHidden();
    });
  }
}

async function assertAuthenticatedPage(page, baseURL) {
  const origin = new URL(baseURL).origin;
  const accountRead = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === origin && url.pathname === '/api/v1/account' && response.request().method() === 'GET';
  }, { timeout: 10_000 });
  const [response] = await Promise.all([accountRead, page.goto('/app/account', { waitUntil: 'load' })]);
  if (response.status() !== 200) throw new Error('Authenticated account read did not return 200');
  await expect(page.getByRole('heading', { name: 'Set a new password', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Account: / })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
}

function watchAuthentication(context, baseURL) {
  const origin = new URL(baseURL).origin;
  let lost = false;
  const onResponse = response => {
    const url = new URL(response.url());
    if (url.origin === origin && ['/api/v1/account', '/api/auth/session'].includes(url.pathname) && response.status() === 401) lost = true;
  };
  context.on('response', onResponse);
  return {
    assert() { if (lost) throw new Error('Authenticated session was lost during page sweep'); },
    stop() { context.off('response', onResponse); },
  };
}

function browserErrorDetails(errors, entry) {
  const redact = text => entry.sensitive
    ? text.replaceAll(entry.pathname, entry.template)
      .replaceAll(entry.pathname.split(/[?#]/, 1)[0], entry.template)
    : text;
  // Each error carries the address of the document that raised it.
  return errors.map(({ url, message }) => ({ url: redact(url), message: redact(message) }));
}

function darkRouteOutcome(status) {
  // worker.js answers a route behind an off flag with an empty 404; switched on,
  // the route renders like any other. Anything else, a 5xx above all, is a defect.
  if (status === 200) return 'render';
  if (status === 404) return 'dark';
  throw new Error(`Dark route answered ${status}; expected 200 (flag on) or 404 (flag off)`);
}

// One batch of template cards on /app and /presets (#1631).
const GALLERY_BATCH = 50;

test('every page template and every sitemap page renders within accessibility and performance budgets', async ({ page, context, request, baseURL }, testInfo) => {
  await handlePrivacyChoices(page);
  const blockedWrites = [];
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const sameOrigin = url.origin === new URL(baseURL).origin;
    let refresh = false;
    if (process.env.QA_ANONYMOUS_READ_ONLY !== '1' && sameOrigin && url.pathname === '/api/auth/session' && req.method() === 'POST') {
      try { refresh = req.postDataJSON()?.action === 'refresh'; } catch { /* malformed requests remain blocked */ }
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method()) && !refresh) {
      blockedWrites.push({ method: req.method(), pathname: url.pathname });
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  const response = await request.get('/sitemap.xml');
  expect(response.ok(), 'sitemap is required for complete concrete public-page coverage').toBeTruthy();
  const fixtures = JSON.parse(process.env.QA_PAGE_FIXTURES || '{}');
  const fullManifest = buildPageManifest(sitemapPaths(await response.text(), baseURL), fixtures);
  // QA_SHARD="i/n" runs every n-th page starting at the i-th, so a matrix of jobs covers the whole manifest in parallel.
  const shard = /^(\d+)\/(\d+)$/.exec(process.env.QA_SHARD || '');
  const shardIndex = shard ? Number(shard[1]) : 1;
  const shardCount = shard ? Number(shard[2]) : 1;
  if (shardIndex < 1 || shardIndex > shardCount) throw new Error(`QA_SHARD ${process.env.QA_SHARD} is out of range`);
  const manifest = fullManifest.filter((_, index) => index % shardCount === shardIndex - 1);
  const results = [];
  const authenticated = testInfo.project.name.endsWith('-authenticated');
  const authentication = { required: authenticated, before: false, after: false };
  const authenticationMonitor = authenticated ? watchAuthentication(context, baseURL) : null;
  const outputPath = testInfo.outputPath('page-coverage.json');
  await mkdir(path.dirname(outputPath), { recursive: true });
  const writeReport = () => writeFile(outputPath, JSON.stringify({ project: testInfo.project.name,
    manifestTemplates: new Set(manifest.map(({ template }) => template)).size, authentication, results, blockedWrites }, null, 2));
  try {
  if (authenticated) {
    await assertAuthenticatedPage(page, baseURL);
    authenticationMonitor.assert();
    authentication.before = true;
  }
  for (const entry of manifest) {
    const label = entry.sensitive ? entry.template : entry.pathname;
    const result = { ...entry, pathname: label };
    results.push(result);
    await test.step(`${label} [${entry.mode}; ${entry.access}]`, async () => {
      const errors = [];
      const watched = page;
      const onError = (error) => errors.push({ url: watched.url(), message: error.stack || error.message });
      // Unload the previous document first, so an error it raises late is not recorded against this entry.
      await watched.goto('about:blank');
      watched.on('pageerror', onError);
      try {
        if (entry.mode === 'dark-route' && darkRouteOutcome((await request.get(entry.pathname)).status()) === 'dark') {
          // Chromium will not commit an empty 404 (net::ERR_HTTP_RESPONSE_CODE_FAILURE), so page.goto rejects.
          const darkStatus = await page.goto(entry.pathname, { waitUntil: 'load' }).then(res => res?.status() || 0, (error) => {
            if (error.message.includes('ERR_HTTP_RESPONSE_CODE_FAILURE')) return 404;
            throw error;
          });
          Object.assign(result, { status: darkStatus, dark: true });
          expect(darkStatus, `dark route stays a controlled 404: ${label}`).toBe(404);
          expect(errors.length, `uncaught errors on dark route: ${label}`).toBe(0);
          return;
        }
        const res = await page.goto(entry.pathname, { waitUntil: 'load' });
        if (entry.pathname === '/m') await page.waitForURL(new URL('/m/create', baseURL).href, { waitUntil: 'load' });
        const status = res?.status() || 0;
        const gated = entry.access === 'admin-gate' && (new URL(page.url()).hostname !== new URL(baseURL).hostname || [401, 403].includes(status));
        const metrics = await page.evaluate(() => {
          const nav = performance.getEntriesByType('navigation')[0];
          return { ttfbMs: nav?.responseStart - nav?.requestStart, htmlBytes: nav?.decodedBodySize,
            domNodes: document.querySelectorAll('*').length, images: document.images.length,
            overflowPx: Math.max(0, document.documentElement.scrollWidth - innerWidth) };
        });
        Object.assign(result, { status, gated, ...metrics });
        expect(status, label).toBeGreaterThan(0);
        expect(status, label).toBeLessThan(500);
        if (gated) return;
        if (entry.mode === 'negative-path') {
          // A placeholder exercises rejection only; it never claims valid-token workflow coverage.
          expect(status === 404 || status === 403 || status === 400 || status === 200, 'controlled missing-resource response').toBeTruthy();
          await expect(page.locator('body')).not.toHaveText('');
          expect(errors.length, `uncaught errors on missing-fixture path: ${label}`).toBe(0);
          return;
        }
        expect(status, label).toBe(200);
        await expect(page.locator('body')).not.toHaveText('');
        expect(metrics.overflowPx, `horizontal page overflow: ${label}`).toBeLessThanOrEqual(2);
        expect(metrics.domNodes, `DOM node budget: ${label}`).toBeLessThan(3000);
        expect(metrics.htmlBytes, `uncompressed HTML budget: ${label}`).toBeLessThan(800 * 1024);
        expect(metrics.ttfbMs, `cold navigation TTFB budget: ${label}`).toBeLessThan(5000);
        if (entry.pathname === '/app' || entry.pathname === '/presets') {
          // The first batch is rendered on the client, so wait for it rather than counting too early.
          const cards = page.locator('#preset-gallery-results > a');
          await expect(cards, 'first gallery batch renders').toHaveCount(GALLERY_BATCH);
          // Each card has a poster image, plus the roller's sample of up to 48.
          expect(await page.locator('#preset-gallery-results img').count(), 'first gallery batch is bounded').toBeLessThanOrEqual(GALLERY_BATCH);
          expect(metrics.images, 'first gallery page is bounded').toBeLessThanOrEqual(110);
          await page.getByRole('button', { name: 'Show more templates' }).click();
          await expect(cards).toHaveCount(GALLERY_BATCH * 2);
        }
        let timer;
        let scan;
        try {
          scan = await Promise.race([
            new AxeBuilder({ page }).setLegacyMode().options({ iframes: false })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Accessibility scan exceeded 20 seconds')), 20_000); }),
          ]);
        } catch (error) {
          if (error.message === 'Accessibility scan exceeded 20 seconds') {
            // A stalled renderer must not prevent the remaining pages from being tested.
            await page.close({ runBeforeUnload: false });
            page = await context.newPage();
            await handlePrivacyChoices(page);
          }
          throw error;
        } finally { clearTimeout(timer); }
        const { violations } = scan;
        const serious = violations.filter(({ impact }) => impact === 'critical' || impact === 'serious');
        result.accessibility = serious.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
        expect(result.accessibility, `serious accessibility violations: ${label}`).toEqual([]);
        expect(errors.length, `uncaught browser errors: ${label}`).toBe(0);
      } finally {
        result.browserErrors = browserErrorDetails(errors, entry);
        watched.off('pageerror', onError);
      }
    }).catch((error) => {
      result.failure = entry.sensitive ? error.message.replaceAll(entry.pathname, label) : error.message;
      // Continue the sweep to report every page, then fail once with the complete artifact.
    });
    await writeReport();
  }
  if (authenticated) {
    await assertAuthenticatedPage(page, baseURL);
    authenticationMonitor.assert();
    authentication.after = true;
  }
  expect(results.filter(({ failure }) => failure), 'see page-coverage.json for every failing page').toEqual([]);
  } finally {
    authenticationMonitor?.stop();
    await writeReport();
    await testInfo.attach('page-coverage.json', { path: outputPath, contentType: 'application/json' });
  }
});
