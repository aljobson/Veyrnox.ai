import { test as base, expect } from '@playwright/test';
import { capabilityFor, publicCapabilities, lengthsFor } from '../../lib/modelCapabilities.js';
import { readdirSync } from 'node:fs';
import { PAGE_TEMPLATES, templateMatches } from '../page-manifest.mjs';

export { expect };
export const SYNTHETIC_USER = Object.freeze({ id: '00000000-0000-4000-8000-000000000001', email: 'synthetic-feature-qa@example.invalid' });
export const SECOND_SYNTHETIC_USER = Object.freeze({ id: '00000000-0000-4000-8000-000000000099', email: 'second-synthetic-qa@example.invalid' });
export const WORKSPACE = '00000000-0000-4000-8000-000000000010';
export const PROJECT = '00000000-0000-4000-8000-000000000020';
const SESSION_KEY = 'veyrnox_supabase_session';
const installed = new WeakMap();
const publicFiles = new Set();
function listPublic(directory = new URL('../../public/', import.meta.url), prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) listPublic(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`);
    else if (entry.isFile()) publicFiles.add(`/${prefix}${entry.name}`);
  }
}
listPublic();

export const test = base.extend({
  syntheticSafety: [async ({ page }, runTest) => {
    try { await runTest(); }
    finally {
      const fixture = installed.get(page);
      if (fixture) {
        try { await fixture.finish(); }
        finally {
          expect(fixture.unhandled, 'Every product/auth API must have an explicit synthetic response').toEqual([]);
          expect(fixture.errors, 'No browser runtime errors').toEqual([]);
        }
      }
    }
  }, { auto: true }],
});

export const SYNTHETIC_MODELS = [
  ['flux-2-pro', 'fal-ai/flux-2-pro', 'text-to-image', 2],
  ['seedance-2.0-fast', 'bytedance/seedance-2.0-fast', 'text-to-video', 28],
  ['ace-step', 'fal-ai/ace-step', 'text-to-audio', 1],
  ['elevenlabs-tts-turbo', 'fal-ai/elevenlabs/tts/turbo-v2.5', 'text-to-speech', 4],
  ['latentsync', 'fal-ai/latentsync', 'video-to-video', 13],
].map(([id, endpoint, modality, credits]) => {
  const record = capabilityFor(endpoint);
  return { id, name: `Synthetic ${id}`, modality, credits, gated: false, durations: lengthsFor(record), capabilities: publicCapabilities(record) };
});

/** Install before any navigation. Only owned localhost HTML/static GETs can reach the network. */
export async function installProductFixtures(page, options = {}) {
  const origin = options.origin || base.info().project.use.baseURL;
  const target = new URL(origin);
  if (target.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.username || target.password) throw new Error('Synthetic product fixture requires loopback HTTP');
  const state = { balance: 1000, user: options.user === undefined ? { ...SYNTHETIC_USER } : options.user, ...options.state };
  const fixture = { state, requests: [], analyticsRequests: [], unhandled: [], blocked: [], errors: [] };
  // The dedicated CI build enables only a made-up analytics key. Fulfill its
  // SDK bootstrap locally; never let the local ingest proxy reach a vendor.
  const analyticsScripts = new Set(['/ingest/array/phc_synthetic_privacy_qa/config.js',
    '/ingest/static/1.438.10/exception-autocapture.js', '/ingest/static/exception-autocapture.js']);
  const analyticsCaptures = new Set(['/ingest/e/', '/ingest/i/v0/e/', '/ingest/batch/']);
  const context = page.context();
  const pendingRoutes = new Set(), pendingPreparations = new Set();
  const preparedPages = new WeakSet();
  const preparePage = async currentPage => {
    if (preparedPages.has(currentPage)) return;
    preparedPages.add(currentPage);
    currentPage.on('pageerror', error => fixture.errors.push(error.message));
    await currentPage.addLocatorHandler(currentPage.locator('[data-storage-notice="analytics"]'), async banner => {
      await banner.locator('[data-storage-decline]').click();
    });
    await currentPage.addLocatorHandler(currentPage.locator('[data-storage-notice="essential"]'), async banner => {
      await banner.locator('[data-storage-dismiss]').click();
    });
  };
  await preparePage(page);
  const onPage = currentPage => {
    const preparation = preparePage(currentPage).catch(error => { fixture.errors.push(error.message); });
    pendingPreparations.add(preparation);
    void preparation.finally(() => pendingPreparations.delete(preparation));
  };
  context.on('page', onPage);
  const metadata = user => user ? { cookie_session: true, expires_at: Math.floor(Date.now() / 1000) + 3600, user, revision: 'synthetic-only' } : null;
  await page.context().addInitScript(({ key, value }) => { if (value && !localStorage.getItem(key) && localStorage.getItem('veyrnox_session_signed_out') !== '1') localStorage.setItem(key, JSON.stringify(value)); }, { key: SESSION_KEY, value: metadata(state.user) });
  const handleRoute = async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    let body = null;
    try { body = request.postDataJSON(); } catch { /* Binary fixture bodies are never treated as JSON. */ }
    const entry = { method, path: url.pathname, query: url.search, body, idempotencyKey: request.headers()['idempotency-key'] || null };
    const json = async (value, status = 200, headers = {}) => { await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(value) }); return true; };
    if (await options.routes?.({ route, request, url, method, body, json, state, origin: target.origin })) {
      fixture.requests.push(entry); return;
    }
    // The owned local build uses this public Supabase URL. AuthGate reads only
    // provider availability here; it must not contact even a local auth server.
    if (url.origin === 'http://127.0.0.1:54321' && url.pathname === '/auth/v1/settings' && ['GET', 'OPTIONS'].includes(method)) {
      fixture.requests.push(entry);
      return json({ passkeys_enabled: false, external: {} }, 200, { 'access-control-allow-origin': target.origin, 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': '*' });
    }
    if (url.origin !== target.origin) {
      // No external resource is implicitly trusted: explicit overrides above must
      // fulfill synthetic auth/provider/media fixtures before this fail-closed path.
      const unexpected = { method, origin: url.origin, path: url.pathname };
      fixture.blocked.push(unexpected);
      fixture.unhandled.push(unexpected);
      return route.abort('blockedbyclient');
    }
    if (method === 'GET' && analyticsScripts.has(url.pathname)) {
      fixture.analyticsRequests.push(entry);
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    }
    if (method === 'GET' && url.pathname === '/ingest/array/phc_synthetic_privacy_qa/config') {
      fixture.analyticsRequests.push(entry);
      return json({ featureFlags: {}, featureFlagPayloads: {}, sessionRecording: false });
    }
    if (method === 'POST' && analyticsCaptures.has(url.pathname)) {
      fixture.analyticsRequests.push(entry);
      return json({ status: 1 });
    }
    if (url.pathname.startsWith('/api/')) {
      fixture.requests.push(entry);
      if (url.pathname === '/api/auth/session') {
        if (method === 'POST' && body?.action === 'refresh') return state.user ? json({ access_token: 'SYNTHETIC-NONSECRET-NOT-A-REAL-TOKEN', expires_in: 3600, user: state.user }) : json({ error: 'not_authenticated' }, 401);
        fixture.unhandled.push({ method, path: url.pathname });
        return route.abort('blockedbyclient');
      }
      if (method === 'GET') {
        if (url.pathname === '/api/catalog') return json({ models: options.models || SYNTHETIC_MODELS });
        if (url.pathname === '/api/status') return json({ status: 'ok', checkedAt: Date.now() });
        if (url.pathname === '/api/v1/account') return state.user ? json({ email: state.user.email, credits: state.balance, balance: state.balance, assets: 0 }) : json({ error: 'not_authenticated' }, 401);
        if (url.pathname === '/api/v1/account/language') return state.user ? json({ locale: null }) : json({ error: 'not_authenticated' }, 401);
        if (url.pathname === '/api/v1/balance') return state.user ? json({ balance: state.balance }) : json({ error: 'not_authenticated' }, 401);
        if (url.pathname === '/api/v1/checkin') return state.user
          ? json({ ok: true, claimed_today: true, streak: 3, next_day: 4, next_credits: 4, rewards: [1, 2, 3, 4, 5, 5] })
          : json({ error: 'not_authenticated' }, 401);
        if (url.pathname === '/api/v1/free-allowance') return json({ enabled: false, left: {} });
        if (url.pathname === '/api/v1/jobs') return json({ jobs: [], next: null });
        if (url.pathname === '/api/v1/library/masters') return json({ masters: [], next: null });
        if (url.pathname === '/api/v1/library/editor-renders') return json({ renders: [], next: null });
        if (url.pathname === '/api/v1/chat/models') return json({ models: [{ id: 'synthetic-chat', name: 'Synthetic chat', credits_per_reply: 1, options: {} }] });
        if (url.pathname === '/api/v1/chat/threads') return json({ threads: [] });
        if (url.pathname === '/api/v1/chat/folders') return json({ folders: [] });
        if (url.pathname === '/api/v1/chat/personas') return json({ enabled: false, personas: [] });
        if (url.pathname === '/api/v1/workspaces') return json({ workspaces: [{ id: WORKSPACE, name: 'Synthetic workspace', role: 'owner' }] });
      }
      fixture.unhandled.push({ method, path: url.pathname });
      return ['GET', 'HEAD', 'OPTIONS'].includes(method) ? json({ error: 'synthetic_route_unhandled' }, 501) : route.abort('blockedbyclient');
    }
    const knownPage = PAGE_TEMPLATES.some(({ route }) => templateMatches(route, url.pathname));
    const knownStatic = url.pathname.startsWith('/_next/static/') || publicFiles.has(decodeURI(url.pathname));
    if (!['GET', 'HEAD'].includes(method) || request.headers().authorization || (!knownPage && !knownStatic)) {
      fixture.unhandled.push({ method, path: url.pathname }); return route.abort('blockedbyclient');
    }
    // Playwright does not reroute redirects after continue(). Never follow a
    // server redirect, even from an otherwise allowed local document or asset.
    const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
    if (response.status() >= 300 && response.status() < 400) {
      fixture.unhandled.push({ method, path: url.pathname, status: response.status(), reason: 'redirect_not_allowed' });
      return route.abort('blockedbyclient');
    }
    return route.fulfill({ response });
  };
  await context.route('**/*', route => {
    // Register synchronously, before any await in this callback. The test's
    // last assertion can otherwise race a still-running fetch/fulfill pair.
    const pending = handleRoute(route);
    pendingRoutes.add(pending);
    return pending.catch(error => { fixture.errors.push(error.message); throw error; })
      .finally(() => pendingRoutes.delete(pending));
  });
  const drain = async () => {
    // Route failures are recorded AND rethrown above; settled here means we
    // finish observing all tasks before the final audit, not ignore errors.
    while (pendingRoutes.size || pendingPreparations.size) {
      await Promise.allSettled([...pendingRoutes, ...pendingPreparations]);
    }
  };
  fixture.finish = async () => {
    // BrowserContext.close() disposes its APIRequestContext before closing
    // pages. Keep response UIDs and our fail-closed guard alive until every
    // owned page is gone and every pending fetch/fulfill has completed.
    do {
      while (context.pages().length) {
        await Promise.all(context.pages().map(currentPage => currentPage.close({ runBeforeUnload: false })));
      }
      await drain();
    } while (context.pages().length);
    await context.unrouteAll({ behavior: 'wait' });
    await drain();
    context.off('page', onPage);
  };
  fixture.open = async path => {
    const response = await page.goto(`${target.origin}${path}`, { waitUntil: 'load' });
    return response;
  };
  fixture.switchUser = async user => {
    state.user = user;
    await page.evaluate(({ key, value }) => {
      if (value) { localStorage.removeItem('veyrnox_session_signed_out'); localStorage.setItem(key, JSON.stringify(value)); }
      else { localStorage.removeItem(key); localStorage.setItem('veyrnox_session_signed_out', '1'); }
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: value ? JSON.stringify(value) : null, storageArea: localStorage }));
    }, { key: SESSION_KEY, value: metadata(user) });
  };
  installed.set(page, fixture);
  return fixture;
}
