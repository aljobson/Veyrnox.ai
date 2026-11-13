import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PREVIEW_FLAG = 'veyrnox_music_preview';
const STORE_KEY = 'veyrnox_music_preview_v1';

test.beforeEach(async ({ page }) => {
  page.qaFailures = [];
  page.on('console', (message) => {
    // Reticle's optional development websocket is not running in this isolated
    // Playwright process. Its generic resource error is covered by the
    // requestfailed guard below, which excludes only that known dev-tool URL.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource: net::ERR_CONNECTION_REFUSED') && !isExpectedDevProbe(message.location().url)) {
      page.qaFailures.push(`console: ${message.text()}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 500) page.qaFailures.push(`${response.status()} ${response.url()}`);
  });
  page.on('pageerror', (error) => page.qaFailures.push(`page error: ${error.message}`));
  page.on('requestfailed', (request) => {
    if (!isExpectedDevProbe(request.url())) page.qaFailures.push(`request failed: ${request.url()} ${request.failure()?.errorText || ''}`);
  });
});

function isExpectedDevProbe(url) {
  return url.endsWith('/reticle') || url === 'http://127.0.0.1:54321/auth/v1/settings';
}

test.afterEach(async ({ page }) => {
  expect(page.qaFailures, 'no console errors or 5xx responses').toEqual([]);
});

async function freshPreview(page) {
  await page.goto('/app/music/create');
  await page.evaluate(([flag, store]) => {
    localStorage.setItem(flag, '1');
    document.cookie = `${flag}=1; Path=/; Max-Age=86400; SameSite=Lax`;
    localStorage.removeItem(store);
  }, [PREVIEW_FLAG, STORE_KEY]);
  await page.reload();
}

async function accessibility(page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations, result.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
}

async function createSimplePair(page, prompt = 'Slow instrumental harbour lights with brushed drums') {
  await page.getByRole('textbox', { name: /describe the sound/i }).fill(prompt);
  await page.getByRole('button', { name: /create two versions/i }).click();
}

test('F02-H1 enables the preview, creates two songs, plays and reopens one', async ({ page }) => {
  await page.goto('/app/music/create');
  await expect(page.getByRole('heading', { name: 'Music Studio is closed here.' })).toBeVisible();
  await page.getByRole('button', { name: 'Enable local Music preview' }).click();
  await expect(page.getByRole('heading', { name: 'Create a private sound draft.' })).toBeVisible();
  await accessibility(page);

  await createSimplePair(page);
  await expect(page.getByText('40 cr')).toBeVisible();
  await expect(page.getByTestId('music-candidate-A')).toHaveAttribute('data-status', 'ready', { timeout: 8_000 });
  await expect(page.getByTestId('music-candidate-B')).toHaveAttribute('data-status', 'ready', { timeout: 8_000 });
  await accessibility(page);

  const play = page.getByRole('button', { name: 'Play preview' }).first();
  await play.click();
  const audio = page.locator('audio').first();
  await expect.poll(() => audio.evaluate((element) => element.paused)).toBe(false);
  await expect.poll(() => audio.evaluate((element) => element.duration)).toBe(8);
  await audio.evaluate((element) => element.pause());

  await page.getByRole('link', { name: 'Music Library' }).click();
  await expect(page.getByRole('heading', { name: 'Music Library' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Music versions' }).getByRole('article')).toHaveCount(2);
  await accessibility(page);

  await page.getByRole('link', { name: /slow instrumental harbour lights/i }).first().click();
  await expect(page.getByRole('heading', { name: /slow instrumental harbour lights/i })).toBeVisible();
  await expect(page.getByLabel(/preview slow instrumental harbour lights/i)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /slow instrumental harbour lights/i })).toBeVisible();
  await accessibility(page);
});

test('F02-E1 empty and whitespace-only directions cannot spend credits', async ({ page }) => {
  await freshPreview(page);
  await page.goto('/app/music/create');
  const create = page.getByRole('button', { name: 'Add a direction first' });
  await expect(create).toBeDisabled();
  await page.getByRole('textbox', { name: /describe the sound/i }).fill('   ');
  await expect(create).toBeDisabled();
  await expect(page.getByText('50 cr')).toBeVisible();
});

test('F02-E2 emoji, accents and the 500-character boundary remain intact', async ({ page }) => {
  await freshPreview(page);
  await page.goto('/app/music/create');
  const prompt = `Été nocturne 🎷 ${'x'.repeat(484)}`;
  expect(prompt.length).toBe(500);
  await createSimplePair(page, prompt);
  await expect(page.getByText('40 cr')).toBeVisible();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORE_KEY);
  expect(saved.requests).toHaveLength(1);
  expect(saved.requests[0].prompt).toBe(prompt);
});

test('F02-E3 a double click creates one pair and one debit', async ({ page }) => {
  await freshPreview(page);
  await page.goto('/app/music/create');
  await page.getByRole('textbox', { name: /describe the sound/i }).fill('One guarded request');
  await page.getByRole('button', { name: /create two versions/i }).evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(page.getByText('40 cr')).toBeVisible();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORE_KEY);
  expect(saved.requests).toHaveLength(1);
  expect(saved.requests[0].candidates).toHaveLength(2);
  expect(saved.ledger.filter((entry) => entry.amount === -10)).toHaveLength(1);
});

test('F02-E4 two tabs and refresh converge on the same durable browser state', async ({ page, context }) => {
  await freshPreview(page);
  await page.goto('/app/music/create');
  const second = await context.newPage();
  second.qaFailures = page.qaFailures;
  second.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource: net::ERR_CONNECTION_REFUSED') && !isExpectedDevProbe(message.location().url)) {
      page.qaFailures.push(`tab 2 console: ${message.text()}`);
    }
  });
  second.on('response', (response) => {
    if (response.status() >= 500) page.qaFailures.push(`tab 2: ${response.status()} ${response.url()}`);
  });
  second.on('pageerror', (error) => page.qaFailures.push(`tab 2 page error: ${error.message}`));
  second.on('requestfailed', (request) => {
    if (!isExpectedDevProbe(request.url())) page.qaFailures.push(`tab 2 request failed: ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  await second.goto('/app/music/library');
  await createSimplePair(page, 'Two tabs share this request');
  await expect(second.getByText('40 preview credits')).toBeVisible();
  await expect(second.getByRole('region', { name: 'Music versions' }).getByRole('article')).toHaveCount(2);
  await second.reload();
  await expect(second.getByText('40 preview credits')).toBeVisible({ timeout: 15_000 });
  await expect(second.getByRole('region', { name: 'Music versions' }).getByRole('article')).toHaveCount(2);
  await second.close();
});

test('F02-E5 cancellation and one-candidate failure refund exactly five credits', async ({ page }) => {
  await freshPreview(page);
  await page.goto('/app/music/create');
  await page.getByRole('textbox', { name: /describe the sound/i }).fill('Cancel version A');
  await page.getByRole('button', { name: /create two versions/i }).click();
  await page.getByTestId('music-candidate-A').getByRole('button', { name: /cancel/i }).click();
  await expect(page.getByText('45 cr')).toBeVisible();
  await expect(page.getByTestId('music-candidate-A')).toHaveAttribute('data-status', 'cancelled');
  await expect(page.getByTestId('music-candidate-B')).toHaveAttribute('data-status', 'ready', { timeout: 8_000 });

  await page.getByRole('button', { name: /reset preview/i }).click();
  await page.getByRole('combobox', { name: /preview outcome/i }).selectOption('fail-b');
  await createSimplePair(page, 'Version B should fail');
  await expect(page.getByTestId('music-candidate-B')).toHaveAttribute('data-status', 'failed', { timeout: 8_000 });
  await expect(page.getByText('45 cr')).toBeVisible();
  await expect(page.getByText('5 credits returned to the preview balance.')).toBeVisible();
});

test('F03-H1 Custom preserves lyrics, style and title through Library search', async ({ page }) => {
  await freshPreview(page);
  await page.goto('/app/music/create');
  await page.getByRole('tab', { name: 'Custom' }).click();
  await page.getByRole('textbox', { name: /original lyrics or structure/i }).fill('[Verse]\nCafé lights, déjà vu ✨');
  await page.getByRole('textbox', { name: 'Style direction' }).fill('Warm vocal, spare piano, 84 bpm');
  await page.getByRole('textbox', { name: /working title/i }).fill('Harbour Frame');
  await page.getByRole('button', { name: /create two versions/i }).click();
  await expect(page.getByTestId('music-candidate-A')).toHaveAttribute('data-status', 'ready', { timeout: 8_000 });
  await page.getByRole('link', { name: 'Music Library' }).click();
  await page.getByRole('searchbox', { name: 'Search Music Library' }).fill('Harbour');
  await expect(page.getByRole('link', { name: 'Harbour Frame' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Ready' }).click();
  await expect(page.getByRole('region', { name: 'Music versions' }).getByRole('article')).toHaveCount(2);
  await accessibility(page);
});

test('F03-N1 Custom with no lyrics or style cannot submit', async ({ page }) => {
  await freshPreview(page);
  await page.goto('/app/music/create');
  await page.getByRole('tab', { name: 'Custom' }).click();
  await expect(page.getByRole('button', { name: 'Add a direction first' })).toBeDisabled();
  await expect(page.getByText('50 cr')).toBeVisible();
});

test('F12-E1 Library filters, empty search and unknown detail are honest', async ({ page }) => {
  await freshPreview(page);
  await page.goto('/app/music/library');
  await expect(page.getByRole('heading', { name: 'No private versions yet.' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search Music Library' }).fill('nothing');
  await expect(page.getByRole('heading', { name: 'No private versions yet.' })).toBeVisible();
  await page.goto('/app/music/songs/not-here');
  await expect(page.getByRole('heading', { name: 'This version is not in this browser.' })).toBeVisible();
});

test('F02-E6 mobile width, keyboard entry and screen-reader labels remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshPreview(page);
  await page.goto('/app/music/create');
  const input = page.getByRole('textbox', { name: /describe the sound/i });
  await input.focus();
  await page.keyboard.type('Keyboard-only night drive');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /create two versions/i })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('40 cr')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await accessibility(page);
});

test('F02-N1 the preview never calls a music provider or gated backend', async ({ page }) => {
  await freshPreview(page);
  const musicRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/music/') || /fal\.run|suno\.com/.test(request.url())) musicRequests.push(request.url());
  });
  await page.goto('/app/music/create');
  await createSimplePair(page, 'No network generation');
  await expect(page.getByText('40 cr')).toBeVisible();
  expect(musicRequests).toEqual([]);

  const response = await page.request.post('/api/v1/music/generation-quotes', {
    headers: { 'content-type': 'application/json', 'x-veyrnox-auth-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    data: { prompt: 'forged header' },
  });
  expect(response.status()).toBe(401);
});
