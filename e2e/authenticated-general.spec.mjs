import { test, expect, installProductFixtures } from './fixtures/authenticated-product.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
async function fixtureFor(page, options = {}) {
  return installProductFixtures(page, { ...options, routes: async args => {
    const { url, method, route, json, origin } = args;
    if (url.origin !== origin) return false;
    if (await options.routes?.(args)) return true;
    if (method !== 'GET') return false;
    if (url.pathname === '/_next/image' && /^\/(?:oddlings\/(?:portraits\/)?|showcase\/)[a-zA-Z0-9_.-]+\.(?:webp|png|jpe?g)$/.test(url.searchParams.get('url') || '')) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: png }); return true;
    }
    if (url.pathname === '/api/popular-templates') return json({ templates: [] });
    if (url.pathname === '/api/credit-subscription-plans') return json({ error: 'subscriptions_not_open' }, 403);
    if (url.pathname === '/api/v1/subscriptions') return json({ subscription: null });
    if (url.pathname === '/api/credit-packs' || url.pathname === '/api/v1/credit-packs') return json({ packs: [
      { id: 'synthetic-small', credits: 100, price_usd_cents: 1000 },
      { id: 'synthetic-large', credits: 1200, price_usd_cents: 10000 },
    ] });
    if (url.pathname === '/api/v1/ledger/usage') return json({ spent: { day: 0, week: 0, month: 0 }, truncated: false });
    if (url.pathname === '/api/v1/ledger') return json({ entries: [], next: null });
    if (url.pathname === '/api/v1/top-ups') return json({ top_ups: [], next: null });
    return false;
  } });
}
const writes = fixture => fixture.requests.filter(row => !['GET', 'HEAD', 'OPTIONS'].includes(row.method) && !(row.method === 'POST' && row.path === '/api/auth/session' && row.body?.action === 'refresh'));
async function open(fixture, page, path, heading) {
  const response = await fixture.open(path);
  expect(response.status(), 'Actual first-party document must render').toBe(200);
  await expect(path === '/app/enhance' ? page.getByTestId('enhance-title') : path === '/app/library' ? page.getByTestId('library-title') : page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

test('Dashboard authenticated balance, template pagination and filters remain read-only', async ({ page }) => {
  const fixture = await fixtureFor(page);
  await open(fixture, page, '/app', 'Explore presets');
  await expect(page.getByTestId('app-credit-balance')).toBeVisible();
  await expect(page.locator('#preset-gallery-results > a')).toHaveCount(50);
  await page.getByRole('button', { name: 'Show more templates', exact: true }).click();
  await expect(page.locator('#preset-gallery-results > a')).toHaveCount(100);
  const filters = page.getByRole('group', { name: 'Filter templates', exact: true });
  await filters.getByRole('button', { name: 'New', exact: true }).click();
  await expect(filters.getByRole('button', { name: 'New', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await filters.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('#preset-gallery-results > a')).toHaveCount(50);
  expect(writes(fixture)).toEqual([]);
});

test('Credits pack selection never accepts consent or starts checkout and closed Credit subscriptions stay closed', async ({ page }) => {
  const fixture = await fixtureFor(page);
  await open(fixture, page, '/app/credits', 'Your balance');
  const packs = page.getByTestId('credit-packs');
  const consent = packs.getByRole('checkbox');
  const buy = packs.getByTestId('credit-packs-buy');
  await expect(consent).not.toBeChecked(); await expect(buy).toBeDisabled();
  await expect(packs.locator('[data-credit-pack="synthetic-small"]')).toContainText('100 credits — $10 + applicable tax');
  await packs.locator('[data-credit-pack="synthetic-small"]').click();
  await expect(packs.locator('[data-credit-pack="synthetic-small"]').getByRole('radio')).toBeChecked();
  await expect(consent).not.toBeChecked(); await expect(buy).toBeDisabled();
  await expect(packs.locator('[data-credit-pack="synthetic-large"]')).toContainText('1,200 credits — $100 + applicable tax');
  await packs.locator('[data-credit-pack="synthetic-large"]').click();
  await expect(packs.locator('[data-credit-pack="synthetic-large"]').getByRole('radio')).toBeChecked();
  await expect(consent).not.toBeChecked(); await expect(buy).toBeDisabled();
  await expect(page.getByText(/Credit subscriptions aren't open right now/)).toBeVisible();
  await expect(page.getByText('No credit movements yet.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('topup-history-empty')).toHaveText('No Top-ups yet.');
  expect(writes(fixture)).toEqual([]);
});

test('Credits unavailable balance does not invent a number and a reload recovers the protected read', async ({ page }) => {
  let unavailable = true;
  const fixture = await fixtureFor(page, { routes: ({ url, method, json }) => url.pathname === '/api/v1/balance' && method === 'GET' ? unavailable ? json({ error: 'synthetic_balance_unavailable' }, 503) : json({ balance: 1000 }) : false });
  await open(fixture, page, '/app/credits', 'Your balance');
  await expect(page.getByRole('alert').filter({ hasText: "We couldn't read your balance" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buy credits', exact: true })).toHaveCount(0);
  unavailable = false;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Buy credits', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert').filter({ hasText: "We couldn't read your balance" })).toHaveCount(0);
  expect(writes(fixture)).toEqual([]);
});

test('Enhance production-build gate does not expose development-only upload or export controls', async ({ page }) => {
  const fixture = await fixtureFor(page);
  await open(fixture, page, '/app/enhance', 'Video Enhance');
  await expect(page.getByTestId('enhance-unavailable')).toBeVisible();
  await expect(page.getByTestId('enhance-local-only')).toHaveText('Video Enhance is available only in an enabled local development preview.');
  await expect(page.getByTestId('enhance-upload')).toHaveCount(0);
  await expect(page.getByTestId('enhance-export')).toHaveCount(0);
  expect(writes(fixture)).toEqual([]);
});

test('Oddling local reference validation refuses text files without generation or upload', async ({ page }) => {
  const fixture = await fixtureFor(page);
  await fixture.open('/app/oddlings');
  await expect(page.getByTestId('oddling-title')).toHaveText('Design the whole character.');
  await page.getByTestId('oddling-reference-file').setInputFiles({ name: 'synthetic-invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic QA only') });
  await expect(page.getByTestId('oddling-notice')).toHaveText('Choose a JPEG, PNG, WebP or AVIF image.');
  await expect(page.getByTestId('oddling-reference-image')).toHaveCount(0);
  expect(writes(fixture)).toEqual([]);
});

test('Oddling passport save/load and styling remix preserve the local character identity without Generate', async ({ page }) => {
  const fixture = await fixtureFor(page);
  await fixture.open('/app/oddlings');
  await expect(page.getByTestId('oddling-title')).toHaveText('Design the whole character.');
  await page.getByRole('textbox', { name: 'NAME', exact: true }).fill('Synthetic QA character');
  await page.getByRole('textbox', { name: 'NEVER DRIFT · VISUAL CANON', exact: true }).fill('Synthetic canon stays locked.');
  await page.getByRole('button', { name: 'Randomize styling', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'NAME', exact: true })).toHaveValue('Synthetic QA character');
  await expect(page.getByRole('textbox', { name: 'NEVER DRIFT · VISUAL CANON', exact: true })).toHaveValue('Synthetic canon stays locked.');
  await page.getByRole('button', { name: 'Save passport', exact: true }).click();
  await expect(page.getByText('Passport saved to History on this browser.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'History · 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic QA character', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'NAME', exact: true }).fill('Unsaved temporary name');
  await page.getByRole('button', { name: 'Load and edit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'NAME', exact: true })).toHaveValue('Synthetic QA character');
  expect(writes(fixture)).toEqual([]);
});

test('Library empty inventory supports all type/state/favourite filters and remembers grid/list preference', async ({ page }) => {
  const fixture = await fixtureFor(page);
  await open(fixture, page, '/app/library', 'Everything you’ve made');
  await expect(page.getByTestId('library-empty')).toBeVisible();
  for (const state of ['succeeded', 'running', 'queued', 'failed', 'all']) {
    const button = page.getByTestId(`library-state-${state}`);
    await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  const types = page.getByTestId('library-types');
  for (const kind of ['image', 'video', 'audio', 'all', 'favourites']) {
    const button = types.getByTestId(kind === 'favourites' ? 'library-favourites' : `library-kind-${kind}`);
    await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  const layouts = page.getByTestId('library-layout');
  await layouts.getByTestId('library-view-list').click();
  await expect(layouts.getByTestId('library-view-list')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByTestId('library-layout').getByTestId('library-view-list')).toHaveAttribute('aria-pressed', 'true');
  expect(writes(fixture)).toEqual([]);
});

test('Library server rows filter by real catalog type and local favourites without claiming an unconfirmed refund', async ({ page }) => {
  const jobs = [
    { job_id: '00000000-0000-4000-8000-000000000081', model_id: 'flux-2-pro', label: 'Synthetic failed image', credits: 2 },
    { job_id: '00000000-0000-4000-8000-000000000082', model_id: 'ace-step', label: 'Synthetic failed audio', credits: 1 },
  ].map(row => ({ ...row, created_at: '2026-10-16T00:00:00Z', state: 'failed', refunded: false, has_asset: false }));
  const fixture = await fixtureFor(page, { routes: ({ url, method, json }) => {
    if (method !== 'GET') return false;
    if (url.pathname === '/api/v1/jobs') return json({ jobs, next: null });
    const job = jobs.find(row => url.pathname === `/api/v1/jobs/${row.job_id}`);
    return job ? json(job) : false;
  } });
  await open(fixture, page, '/app/library', 'Everything you’ve made');
  await expect(page.getByText('Synthetic failed image', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic failed audio', { exact: true })).toBeVisible();
  await expect(page.locator('[data-library-status="failed_pending"]')).toHaveCount(2);
  await expect(page.locator('[data-library-status="failed_pending"]')).toHaveText(['FAILED · REFUND PENDING', 'FAILED · REFUND PENDING']);
  const types = page.getByTestId('library-types');
  await types.getByTestId('library-kind-image').click();
  await expect(page.getByText('Synthetic failed audio', { exact: true })).toHaveCount(0);
  await page.getByTestId('library-favourite').click();
  await types.getByTestId('library-kind-audio').click();
  await expect(page.getByText('Synthetic failed audio', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic failed image', { exact: true })).toHaveCount(0);
  await types.getByTestId('library-kind-all').click();
  await types.getByTestId('library-favourites').click();
  await expect(page.getByText('Synthetic failed image', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic failed audio', { exact: true })).toHaveCount(0);
  expect(writes(fixture)).toEqual([]);
});

for (const [path, label] of [['/m', 'Create'], ['/m/create', 'Create'], ['/m/job', 'Job running'], ['/m/credits', 'CURRENT BALANCE'], ['/m/explore', 'CACHED FREE'], ['/m/library', 'FAILS REFUND']]) {
  test(`Mobile design prototype ${path} is clearly sample data, not authenticated account feature coverage`, async ({ page }, testInfo) => {
    const fixture = await fixtureFor(page);
    const response = await fixture.open(path); expect(response.status()).toBe(200);
    if (path === '/m') await page.waitForURL('**/m/create');
    const geometry = await page.evaluate(() => ({ layoutWidth: innerWidth, overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), scale: visualViewport?.scale || 1 }));
    expect(geometry.layoutWidth, 'Fixed phone bezel must not expand the mobile layout viewport').toBe(testInfo.project.use.viewport.width);
    expect(geometry.overflow, 'Prototype remains within the actual viewport').toBeLessThanOrEqual(2);
    expect(geometry.scale, 'Prototype must not auto-scale the browser and misalign touch targets').toBeGreaterThanOrEqual(0.99);
    await expect(page.getByRole('note')).toContainText('DESIGN PROTOTYPE · SAMPLE DATA, NOT YOUR ACCOUNT');
    await expect(page.getByRole('note').getByRole('link', { name: 'OPEN THE APP', exact: true })).toHaveAttribute('href', '/app');
    await expect(page.getByRole('main')).toContainText(label);
    if (path === '/m/create') {
      await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Synthetic editable prototype draft');
      await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue('Synthetic editable prototype draft');
      await expect(page.getByRole('link', { name: /Generate/ })).toHaveAttribute('href', '/m/job');
    }
    expect(writes(fixture)).toEqual([]);
  });
}
