import { test, expect, installProductFixtures } from './fixtures/authenticated-product.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
async function fixtureFor(page, options = {}) {
  return installProductFixtures(page, { ...options, routes: async args => {
    const { url, method, route, json, origin } = args;
    if (url.origin !== origin) return false;
    if (await options.routes?.(args)) return true;
    if (method !== 'GET') return false;
    if (url.pathname === '/_next/image' && /^\/(?:oddlings|showcase)\/[a-zA-Z0-9_.-]+\.(?:webp|png|jpe?g)$/.test(url.searchParams.get('url') || '')) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: png }); return true;
    }
    if (url.pathname === '/api/popular-templates') return json({ templates: [] });
    if (url.pathname === '/api/credit-subscription-plans') return json({ error: 'subscriptions_not_open' }, 403);
    if (url.pathname === '/api/v1/subscriptions') return json({ subscription: null });
    if (url.pathname === '/api/v1/credit-packs') return json({ packs: [
      { id: 'synthetic-small', credits: 100, price_usd_cents: 1000 },
      { id: 'synthetic-large', credits: 1200, price_usd_cents: 10000 },
    ] });
    if (url.pathname === '/api/v1/ledger/usage') return json({ spent: { day: 0, week: 0, month: 0 }, truncated: false });
    if (url.pathname === '/api/v1/ledger') return json({ entries: [], next: null });
    if (url.pathname === '/api/v1/top-ups') return json({ top_ups: [], next: null });
    return false;
  } });
}
const writes = fixture => fixture.requests.filter(row => !['GET', 'HEAD', 'OPTIONS'].includes(row.method) && row.path !== '/api/auth/session');
async function open(fixture, page, path, heading) {
  const response = await fixture.open(path);
  expect(response.status(), 'Actual first-party document must render').toBe(200);
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

test('Dashboard authenticated balance, template pagination and filters remain read-only', async ({ page }) => {
  const fixture = await fixtureFor(page);
  await open(fixture, page, '/app', 'Explore presets');
  await expect(page.getByRole('link', { name: 'Credit balance: 1,000 credits', exact: true })).toBeVisible();
  await expect(page.locator('#preset-gallery-results > a')).toHaveCount(12);
  await page.getByRole('button', { name: 'Show more templates', exact: true }).click();
  await expect(page.locator('#preset-gallery-results > a')).toHaveCount(24);
  const filters = page.getByRole('group', { name: 'Filter templates', exact: true });
  await filters.getByRole('button', { name: 'New', exact: true }).click();
  await expect(filters.getByRole('button', { name: 'New', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await filters.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('#preset-gallery-results > a')).toHaveCount(12);
  expect(writes(fixture)).toEqual([]);
});

test('Credits pack selection never accepts consent or starts checkout and closed subscriptions stay closed', async ({ page }) => {
  const fixture = await fixtureFor(page);
  await open(fixture, page, '/app/credits', 'Your balance');
  const packs = page.getByRole('group', { name: 'Choose a credit pack', exact: true });
  const consent = packs.getByRole('checkbox');
  const buy = packs.getByRole('button', { name: 'Buy credits', exact: true });
  await expect(consent).not.toBeChecked(); await expect(buy).toBeDisabled();
  await packs.getByRole('radio', { name: /100 credits —/ }).check();
  await expect(packs.getByRole('radio', { name: /100 credits —/ })).toBeChecked();
  await expect(consent).not.toBeChecked(); await expect(buy).toBeDisabled();
  await packs.getByRole('radio', { name: /1,200 credits —/ }).check();
  await expect(packs.getByRole('radio', { name: /1,200 credits —/ })).toBeChecked();
  await expect(consent).not.toBeChecked(); await expect(buy).toBeDisabled();
  await expect(page.getByText(/Monthly subscriptions aren't open right now/)).toBeVisible();
  await expect(page.getByText('No credit movements yet.', { exact: true })).toBeVisible();
  await expect(page.getByText('No Top-ups yet.', { exact: true })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Preview unavailable', exact: true })).toBeVisible();
  await expect(page.getByText('Video Enhance is available only in an enabled local development preview.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Choose video', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export video', exact: true })).toHaveCount(0);
  expect(writes(fixture)).toEqual([]);
});

test('Oddling local reference validation refuses text files without generation or upload', async ({ page }) => {
  const fixture = await fixtureFor(page);
  await open(fixture, page, '/app/oddlings', 'Design the whole character.');
  await page.getByLabel('Upload photo', { exact: true }).setInputFiles({ name: 'synthetic-invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic QA only') });
  await expect(page.getByText('Choose a JPEG, PNG, WebP or AVIF image.', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /^Local reference/ })).toHaveCount(0);
  expect(writes(fixture)).toEqual([]);
});

test('Oddling passport save/load and styling remix preserve the local character identity without Generate', async ({ page }) => {
  const fixture = await fixtureFor(page);
  await open(fixture, page, '/app/oddlings', 'Design the whole character.');
  await page.getByLabel('NAME', { exact: true }).fill('Synthetic QA character');
  await page.getByLabel('NEVER DRIFT · VISUAL CANON', { exact: true }).fill('Synthetic canon stays locked.');
  await page.getByRole('button', { name: 'Randomize styling', exact: true }).click();
  await expect(page.getByLabel('NAME', { exact: true })).toHaveValue('Synthetic QA character');
  await expect(page.getByLabel('NEVER DRIFT · VISUAL CANON', { exact: true })).toHaveValue('Synthetic canon stays locked.');
  await page.getByRole('button', { name: 'Save passport', exact: true }).click();
  await expect(page.getByText('Passport saved to History on this browser.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'History · 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic QA character', exact: true })).toBeVisible();
  await page.getByLabel('NAME', { exact: true }).fill('Unsaved temporary name');
  await page.getByRole('button', { name: 'Load and edit', exact: true }).click();
  await expect(page.getByLabel('NAME', { exact: true })).toHaveValue('Synthetic QA character');
  expect(writes(fixture)).toEqual([]);
});

test('Library empty inventory supports all type/state/favourite filters and remembers grid/list preference', async ({ page }) => {
  const fixture = await fixtureFor(page);
  await open(fixture, page, '/app/library', 'Everything you’ve made');
  await expect(page.getByText('Nothing here yet.', { exact: true })).toBeVisible();
  for (const state of ['succeeded', 'running', 'queued', 'failed', 'all']) {
    const button = page.getByRole('button', { name: state, exact: true });
    await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  const types = page.getByRole('group', { name: 'Filter by type', exact: true });
  for (const kind of ['Images', 'Video', 'Audio', 'All types', '★ Favourites']) {
    const button = types.getByRole('button', { name: kind, exact: true });
    await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  const layouts = page.getByRole('group', { name: 'Layout', exact: true });
  await layouts.getByRole('button', { name: 'list', exact: true }).click();
  await expect(layouts.getByRole('button', { name: 'list', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('group', { name: 'Layout', exact: true }).getByRole('button', { name: 'list', exact: true })).toHaveAttribute('aria-pressed', 'true');
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
  await expect(page.getByText('FAILED · REFUND PENDING', { exact: true })).toHaveCount(2);
  const types = page.getByRole('group', { name: 'Filter by type', exact: true });
  await types.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(page.getByText('Synthetic failed audio', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Favourite', exact: true }).click();
  await types.getByRole('button', { name: 'Audio', exact: true }).click();
  await expect(page.getByText('Synthetic failed audio', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic failed image', { exact: true })).toHaveCount(0);
  await types.getByRole('button', { name: 'All types', exact: true }).click();
  await types.getByRole('button', { name: '★ Favourites', exact: true }).click();
  await expect(page.getByText('Synthetic failed image', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic failed audio', { exact: true })).toHaveCount(0);
  expect(writes(fixture)).toEqual([]);
});

for (const [path, label] of [['/m', 'Create'], ['/m/create', 'Create'], ['/m/job', 'Job running'], ['/m/credits', 'CURRENT BALANCE'], ['/m/explore', 'CACHED FREE'], ['/m/library', 'FAILS REFUND']]) {
  test(`Mobile design prototype ${path} is clearly sample data, not authenticated account feature coverage`, async ({ page }) => {
    const fixture = await fixtureFor(page);
    const response = await fixture.open(path); expect(response.status()).toBe(200);
    if (path === '/m') await page.waitForURL('**/m/create');
    await expect(page.getByRole('note')).toContainText('DESIGN PROTOTYPE · SAMPLE DATA, NOT YOUR ACCOUNT');
    await expect(page.getByRole('note').getByRole('link', { name: 'OPEN THE APP', exact: true })).toHaveAttribute('href', '/app');
    await expect(page.locator('main')).toContainText(label);
    if (path === '/m/create') {
      await page.getByLabel('Prompt', { exact: true }).fill('Synthetic editable prototype draft');
      await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue('Synthetic editable prototype draft');
      await expect(page.getByRole('link', { name: /Generate/ })).toHaveAttribute('href', '/m/job');
    }
    expect(writes(fixture)).toEqual([]);
  });
}
