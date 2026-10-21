import { test, expect } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { PAGE_TEMPLATES, templateMatches } from './page-manifest.mjs';

// Independent from authenticated-product: its automatic Decline handler would
// conceal the exact consent/reopen regression being exercised here.
const PREFERENCE = 'veyrnox_analytics_preference_v1';
const USER = Object.freeze({ id: '00000000-0000-4000-8000-000000000031', email: 'synthetic-privacy@example.invalid' });
const publicFiles = new Set();
function listPublic(directory = new URL('../public/', import.meta.url), prefix = '') {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.isDirectory()) listPublic(new URL(`${item.name}/`, directory), `${prefix}${item.name}/`);
    else if (item.isFile()) publicFiles.add(`/${prefix}${item.name}`);
  }
}
listPublic();

function captureEvents(request) {
  const raw = request.postDataBuffer();
  if (!raw) return [];
  try {
    let text = raw.toString('utf8');
    if (raw[0] === 0x1f && raw[1] === 0x8b) text = gunzipSync(raw).toString('utf8');
    else if (!text.startsWith('{') && !text.startsWith('[')) {
      const data = new URLSearchParams(text).get('data');
      if (!data) return [];
      const decoded = Buffer.from(data, 'base64');
      text = decoded[0] === 0x1f && decoded[1] === 0x8b ? gunzipSync(decoded).toString('utf8') : decoded.toString('utf8');
    }
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed.batch) ? parsed.batch : [parsed];
  } catch { return []; }
}

async function installPrivacyFixtures(page, origin) {
  const target = new URL(origin);
  if (target.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
      || target.username || target.password) throw new Error('Privacy fixtures require exact loopback HTTP');
  const fixture = { unhandled: [], errors: [], events: [], pending: new Set() };
  const context = page.context();
  page.on('pageerror', error => fixture.errors.push(error.message));
  await context.addInitScript(user => {
    if (!localStorage.getItem('veyrnox_supabase_session')) localStorage.setItem('veyrnox_supabase_session', JSON.stringify({
      cookie_session: true, user, expires_at: Math.floor(Date.now() / 1000) + 3600, revision: 'synthetic-privacy-only',
    }));
  }, USER);
  const routeRequest = async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const json = (data, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(data) });
    if (url.origin === 'http://127.0.0.1:54321' && url.pathname === '/auth/v1/settings' && ['GET', 'OPTIONS'].includes(method)) {
      return json({ passkeys_enabled: false, external: {} }, 200, { 'access-control-allow-origin': target.origin,
        'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': '*' });
    }
    if (url.origin !== target.origin) {
      fixture.unhandled.push({ method, origin: url.origin, path: url.pathname });
      return route.abort('blockedbyclient');
    }
    // These are synthetic responses, never the local /ingest reverse proxy.
    if (url.pathname.startsWith('/ingest/')) {
      fixture.events.push(...captureEvents(request));
      if (url.pathname.endsWith('.js')) return route.fulfill({ contentType: 'application/javascript', body: '' });
      return json({ status: 1, featureFlags: {}, featureFlagPayloads: {}, sessionRecording: false });
    }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/auth/session' && method === 'POST' && request.postDataJSON()?.action === 'refresh') {
        return json({ access_token: 'SYNTHETIC-PRIVACY-NOT-A-REAL-TOKEN', expires_in: 3600, user: USER });
      }
      if (method === 'GET') {
        if (url.pathname === '/api/status') return json({ status: 'ok', checkedAt: Date.now() });
        if (url.pathname === '/api/v1/account/language') return json({ locale: null });
        if (url.pathname === '/api/v1/account') return json({ email: USER.email, credits: 0, balance: 0, assets: 0 });
        if (url.pathname.startsWith('/api/social/approvals/')) return json({ error: 'expired' }, 410);
      }
      fixture.unhandled.push({ method, path: url.pathname });
      return route.abort('blockedbyclient');
    }
    const knownPage = PAGE_TEMPLATES.some(({ route }) => templateMatches(route, url.pathname));
    const knownStatic = url.pathname.startsWith('/_next/static/') || publicFiles.has(decodeURI(url.pathname));
    if (!['GET', 'HEAD'].includes(method) || request.headers().authorization || (!knownPage && !knownStatic)) {
      fixture.unhandled.push({ method, path: url.pathname });
      return route.abort('blockedbyclient');
    }
    const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 30_000 });
    if (response.status() >= 300 && response.status() < 400) {
      fixture.unhandled.push({ method, path: url.pathname, reason: 'redirect_not_allowed' });
      return route.abort('blockedbyclient');
    }
    return route.fulfill({ response });
  };
  await context.route('**/*', route => {
    const pending = routeRequest(route);
    fixture.pending.add(pending);
    return pending.finally(() => fixture.pending.delete(pending));
  });
  fixture.finish = async () => {
    await Promise.all(context.pages().map(current => current.close({ runBeforeUnload: false })));
    while (fixture.pending.size) await Promise.all([...fixture.pending]);
    await context.unrouteAll({ behavior: 'wait' });
    expect(fixture.unhandled, 'No unknown API, mutation, redirect or outbound request').toEqual([]);
    expect(fixture.errors, 'No browser runtime errors').toEqual([]);
  };
  return fixture;
}

const preference = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), PREFERENCE);
const banner = page => page.getByRole('region', { name: 'Privacy choices', exact: true });
const choices = page => page.getByRole('button', { name: 'Privacy choices', exact: true });

for (const [label, selected] of [
  ['Allow analytics & replay', { version: 1, analytics: true, replay: true }],
  ['Analytics only', { version: 1, analytics: true, replay: false }],
  ['Decline', { version: 1, analytics: false, replay: false }],
]) {
  test(`${label}: choices survive client navigation/reload and can be withdrawn and reopened`, async ({ page, baseURL }) => {
    const fixture = await installPrivacyFixtures(page, baseURL);
    try {
      const response = await page.goto('/legal/privacy');
      expect(response.status()).toBe(200);
      await expect(banner(page)).toBeVisible();
      await banner(page).getByRole('button', { name: label, exact: true }).click();
      await expect(banner(page)).toHaveCount(0);
      await expect(choices(page)).toBeVisible();
      expect(await preference(page)).toEqual(selected);

      await page.evaluate(() => { window.__syntheticPrivacyClientNavigation = true; });
      await page.locator('a[href="/legal/terms"]').first().click();
      await expect(page).toHaveURL(/\/legal\/terms$/);
      expect(await page.evaluate(() => window.__syntheticPrivacyClientNavigation)).toBe(true);
      await expect(choices(page)).toBeVisible();
      await page.reload();
      await expect(choices(page)).toBeVisible();
      expect(await preference(page)).toEqual(selected);

      await choices(page).click();
      await expect(banner(page)).toBeVisible();
      await banner(page).getByRole('button', { name: 'Decline', exact: true }).click();
      await expect(choices(page)).toBeVisible();
      expect(await preference(page)).toEqual({ version: 1, analytics: false, replay: false });
      await page.reload();
      await expect(choices(page)).toBeVisible();
      await choices(page).click();
      await expect(banner(page)).toBeVisible();
      expect(await preference(page)).toEqual({ version: 1, analytics: false, replay: false });
    } finally { await fixture.finish(); }
  });
}

test('browser telemetry redacts the synthetic capability bearer on the review route', async ({ page, baseURL }) => {
  const fixture = await installPrivacyFixtures(page, baseURL);
  const marker = 'synthetic-capability-never-a-real-token';
  try {
    await page.goto(`/social/review/${marker}?synthetic_query=never-capture#synthetic-fragment`);
    await banner(page).getByRole('button', { name: 'Analytics only', exact: true }).click();
    await expect.poll(() => fixture.events.filter(event => event.event === '$pageview').length, { timeout: 15_000 }).toBeGreaterThan(0);
    const views = fixture.events.filter(event => event.event === '$pageview');
    expect(JSON.stringify(fixture.events)).not.toContain(marker);
    expect(JSON.stringify(fixture.events)).not.toContain('never-capture');
    expect(JSON.stringify(fixture.events)).not.toContain('synthetic-fragment');
    expect(views.some(event => event.properties?.$pathname === '/social/review/:token')).toBe(true);
  } finally { await fixture.finish(); }
});
