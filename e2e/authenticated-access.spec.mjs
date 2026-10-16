import { test, expect } from './fixtures/authenticated-product.mjs';
import { installAccessFixtures, ADMIN_PAGES, TITLE_ID, ACTION_ID } from './fixtures/access-product.mjs';

async function openReal(fixture, path) {
  const response = await fixture.open(path);
  expect(response.status(), `Actual first-party document ${path}`).toBe(200);
}
// Cookie-session hydration is a synthetic POST refresh, not a product write.
const productWrites = fixture => fixture.requests.filter(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method)
  && !(r.path === '/api/auth/session' && r.method === 'POST' && r.body?.action === 'refresh'));

for (const [suffix, heading, endpoint, loaded] of ADMIN_PAGES) {
  test(`Admin interior ${suffix || '/'} renders explicit authorized data`, async ({ page }) => {
    const fixture = await installAccessFixtures(page);
    await openReal(fixture, `/app/admin${suffix}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    if (endpoint) {
      await expect(page.getByText(loaded, { exact: true })).toBeVisible();
      expect(fixture.requests.some(r => r.path === `/api/v1${endpoint}`)).toBe(true);
      const refresh = {
        '/cinema': 'Refresh applications', '/cinema/submissions': 'Refresh queue',
        '/cinema/comments': 'Refresh comments and reports', '/cinema/voting': 'Refresh voting queue',
        '/cinema/story-polls': 'Refresh story poll queue', '/cinema/rankings': 'Refresh rankings',
      }[suffix];
      if (refresh) {
        const count = fixture.requests.filter(r => r.path === `/api/v1${endpoint}`).length;
        await page.getByRole('button', { name: refresh, exact: true }).click();
        await expect.poll(() => fixture.requests.filter(r => r.path === `/api/v1${endpoint}`).length).toBeGreaterThan(count);
        await expect(page.getByText(loaded, { exact: true })).toBeVisible();
      }
      if (suffix === '/reports' || suffix === '/appeals') {
        const name = suffix === '/reports' ? 'Resolved' : 'Upheld';
        await page.getByRole('tab', { name, exact: true }).click();
        await expect.poll(() => fixture.requests.some(r => r.path === `/api/v1${endpoint}` && r.query.includes(`status=${name.toLowerCase()}`))).toBe(true);
      }
    } else {
      const form = page.getByRole('form', { name: 'Find a user' });
      await form.getByRole('textbox').fill('synthetic-feature-qa@example.invalid');
      await form.getByRole('button', { name: 'Find', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Ledger, newest first' })).toBeVisible();
      expect(fixture.requests.some(r => r.path === '/api/v1/admin/users/ledger')).toBe(true);
    }
  });

  test(`Admin denial ${suffix || '/'} exposes no authorized fixture data`, async ({ page }) => {
    const fixture = await installAccessFixtures(page, { scenario: { adminError: suffix.includes('/cinema') ? 'not_authorized' : 'not_admin' } });
    await openReal(fixture, `/app/admin${suffix}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    if (!endpoint) {
      const form = page.getByRole('form', { name: 'Find a user' });
      await form.getByRole('textbox').fill('synthetic-feature-qa@example.invalid');
      await form.getByRole('button', { name: 'Find', exact: true }).click();
    }
    await expect(page.getByText(/not an administrator|administrator permission is required|Cinema administrator account is required|does not have Cinema .*permission/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By model', exact: true })).toHaveCount(0);
    expect(productWrites(fixture)).toEqual([]);
  });
}

for (const [code, copy] of [
  ['mfa_required', /authenticator|two-factor/i],
  ['access_required', /Cloudflare Access sign-in/i],
]) test(`Admin metrics preserves ${code} and GET-only retry`, async ({ page }) => {
  const fixture = await installAccessFixtures(page, { scenario: { adminError: code } });
  await openReal(fixture, '/app/admin');
  await expect(page.getByRole('status').filter({ hasText: copy }).first()).toBeVisible();
  await expect(page.getByText('This account is not an administrator.', { exact: true })).toHaveCount(0);
  fixture.scenario.adminError = null;
  await page.getByRole('button', { name: 'Retry metrics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'By model', exact: true })).toBeVisible();
});

test('Admin metrics recovers after unavailable read without stale KPIs', async ({ page }) => {
  const fixture = await installAccessFixtures(page, { scenario: { adminFailures: 1 } });
  await openReal(fixture, '/app/admin');
  await expect(page.getByRole('button', { name: 'Retry metrics' })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'By model' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry metrics' }).click();
  await expect(page.getByRole('heading', { name: 'By model' })).toBeVisible();
});

test('Webhook operations time-window tabs issue distinct bounded reads', async ({ page }) => {
  const fixture = await installAccessFixtures(page);
  await openReal(fixture, '/app/admin/webhooks');
  await expect(page.getByRole('heading', { name: 'By source' })).toBeVisible();
  await page.getByRole('tab', { name: 'Last hour', exact: true }).click();
  await expect.poll(() => fixture.requests.some(r => r.path === '/api/v1/admin/webhooks' && r.query.includes('hours=1&'))).toBe(true);
  await page.getByRole('tab', { name: 'Last 7 days', exact: true }).click();
  await expect.poll(() => fixture.requests.some(r => r.path === '/api/v1/admin/webhooks' && r.query.includes('hours=168'))).toBe(true);
});

test('Account security renders private controls, validates password and cancels revocation', async ({ page }) => {
  const fixture = await installAccessFixtures(page);
  await openReal(fixture, '/app/account');
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await expect(page.getByText('No assistants are connected.', { exact: true })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('short');
  await page.getByLabel('Email verification code', { exact: true }).fill('bad');
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  expect(await page.getByLabel('New password', { exact: true }).evaluate(node => node.validity.valid)).toBe(false);
  await page.getByRole('button', { name: 'Sign out other devices', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(productWrites(fixture)).toEqual([]);
});

test('Account authenticator read failure recovers without enrollment', async ({ page }) => {
  const fixture = await installAccessFixtures(page, { scenario: { factorsError: true } });
  await openReal(fixture, '/app/account');
  await expect(page.getByText('Authenticator status is unavailable.', { exact: true })).toBeVisible();
  fixture.scenario.factorsError = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Set up an authenticator app', exact: true })).toBeVisible();
  expect(fixture.requests.filter(r => r.path.includes('/factors'))).toEqual([]);
});

test('Account connected assistant failure has a functional refresh', async ({ page }) => {
  const fixture = await installAccessFixtures(page, { scenario: { oauthError: true } });
  await openReal(fixture, '/app/account');
  const section = page.getByRole('region', { name: 'Connected assistants' });
  await expect(section.getByRole('alert')).toContainText('could not be loaded');
  fixture.scenario.oauthError = false;
  await section.getByRole('button', { name: 'Refresh' }).click();
  await expect(section.getByText('No assistants are connected.', { exact: true })).toBeVisible();
});

test('Content appeal validates statement and transitions synthetic decision once', async ({ page }) => {
  const fixture = await installAccessFixtures(page, { sanction: true });
  await openReal(fixture, '/app/account/appeals');
  await page.getByRole('button', { name: 'Appeal this decision', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send appeal', exact: true })).toBeDisabled();
  await page.getByLabel('Tell us why you think this decision was wrong').fill('Synthetic fixture decision review only.');
  await page.getByRole('button', { name: 'Send appeal', exact: true }).click();
  await expect(page.getByText('Appeal under review', { exact: true })).toBeVisible();
  expect(fixture.requests.filter(r => r.path === '/api/v1/appeals' && r.method === 'POST').map(r => r.body.action_id)).toEqual([ACTION_ID]);
});

test('Content report validates free-text subject and acknowledges intercepted report', async ({ page }) => {
  const fixture = await installAccessFixtures(page);
  await openReal(fixture, '/app/account/report?job=invalid-id');
  await expect(page.getByRole('button', { name: 'Account: synthetic-feature-qa', exact: true })).toBeVisible();
  const form = page.getByRole('form', { name: 'Report content', exact: true });
  await form.getByRole('radio', { name: 'Something else', exact: true }).check();
  await expect(form.getByRole('button', { name: 'Send report', exact: true })).toBeDisabled();
  await form.getByRole('textbox', { name: 'Anything we should know (what and where)', exact: true }).fill('Entirely synthetic QA report; no real content or people.');
  await form.getByRole('button', { name: 'Send report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();
  expect(fixture.requests.find(r => r.path === '/api/v1/reports' && r.method === 'POST').body.subject_kind).toBe('other');
});

test('Cinema creator workspace remains gated without local preview', async ({ page }) => {
  const fixture = await installAccessFixtures(page);
  await openReal(fixture, '/social-cinema/creator');
  await expect(page.getByText('The creator workspace is in preview and is not open yet.', { exact: true })).toBeVisible();
  expect(fixture.requests.some(r => r.path === '/api/v1/cinema/content')).toBe(false);
});

test('Cinema creator saves isolated private draft without upload or publication', async ({ page }) => {
  const fixture = await installAccessFixtures(page, { preview: true });
  await openReal(fixture, '/social-cinema/creator');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('FILM');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Synthetic private film');
  await page.getByRole('textbox', { name: 'Synopsis', exact: true }).fill('No provider, real upload or public destination.');
  await page.getByRole('button', { name: 'Save private draft', exact: true }).click();
  await expect(page.getByText('Draft saved privately.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic private film', exact: true })).toBeVisible();
  expect(productWrites(fixture).map(r => r.path)).toEqual(['/api/v1/cinema/content']);
});

test('Cinema Pass closed sales do not expose checkout', async ({ page }) => {
  const fixture = await installAccessFixtures(page);
  await openReal(fixture, '/social-cinema/pass');
  await expect(page.getByText('Cinema Pass is not open yet.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start .* Pass/ })).toHaveCount(0);
});

test('Cinema Pass requires consent and displays safe intercepted checkout failure', async ({ page }) => {
  const fixture = await installAccessFixtures(page, { preview: true });
  await openReal(fixture, '/social-cinema/pass');
  const start = page.getByRole('button', { name: 'Start monthly Pass', exact: true });
  await expect(start).toBeDisabled();
  await page.getByRole('checkbox').check();
  await start.click();
  await expect(page.getByText('Could not start checkout. Try again in a moment.', { exact: true })).toBeVisible();
  expect(fixture.requests.find(r => r.path === '/api/v1/cinema/pass' && r.method === 'POST').body.consent).toBe(true);
});

test('Cinema title requires unlock consent and handles insufficient balance without spending', async ({ page }) => {
  const fixture = await installAccessFixtures(page);
  await openReal(fixture, `/social-cinema/title/${TITLE_ID}`);
  await expect(page.getByRole('heading', { name: 'Synthetic isolated film' })).toBeVisible();
  const unlock = page.getByRole('button', { name: 'Unlock for 2 credits' });
  await expect(unlock).toBeDisabled();
  await page.getByRole('checkbox').check();
  await unlock.click();
  await expect(page.getByText(/Not enough credits/)).toBeVisible();
  expect(fixture.requests.filter(r => r.path === '/api/v1/cinema/unlocks' && r.method === 'POST')).toHaveLength(1);
});

test('Cinema discovery filters and switches to explicitly closed voting', async ({ page }) => {
  const fixture = await installAccessFixtures(page);
  await openReal(fixture, '/social-cinema');
  await expect(page.getByRole('heading', { name: 'Published series' })).toBeVisible();
  await page.getByRole('button', { name: 'Science fiction', exact: true }).click();
  await expect.poll(() => fixture.requests.some(r => r.path === '/api/cinema/discovery' && r.query.includes('category=science-fiction'))).toBe(true);
  await page.getByRole('navigation', { name: 'Social Cinema', exact: true }).getByRole('button', { name: 'Vote', exact: true }).click();
  await expect(page.getByText('No eligible titles in open competitions yet.', { exact: true })).toBeVisible();
});

test('Cinema valid editorial series renders actual ordered episode links', async ({ page }) => {
  const fixture = await installAccessFixtures(page);
  await openReal(fixture, '/social-cinema/series/black-dwarf');
  await expect(page.getByRole('heading', { name: 'Black Dwarf', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Episodes', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Play episode 1', exact: true })).toHaveAttribute('href', /\/social-cinema\/watch\/.+\?series=black-dwarf/);
});

test('Cinema watch intercepts token, Stream SDK and iframe before navigation', async ({ page }) => {
  const fixture = await installAccessFixtures(page);
  await openReal(fixture, `/social-cinema/watch/${TITLE_ID}`);
  await expect(page.getByTitle('Now playing', { exact: true })).toBeVisible();
  await expect(page.frameLocator('iframe[title="Now playing"]').getByText('Isolated player fixture')).toBeVisible();
  expect(fixture.requests.filter(r => r.path === '/api/v1/cinema/play' && r.method === 'POST')).toHaveLength(1);
  expect(fixture.requests.some(r => r.path === '/embed/sdk.latest.js')).toBe(true);
});

test('OAuth consent invalid request does not call authorization server', async ({ page }) => {
  const fixture = await installAccessFixtures(page);
  await openReal(fixture, '/oauth/consent');
  await expect(page.getByRole('heading', { name: 'Invalid connection request' })).toBeVisible();
  expect(fixture.requests.some(r => r.path.includes('/oauth/authorizations/'))).toBe(false);
});

for (const action of ['approve', 'deny']) test(`OAuth ${action} decision remains synthetic and recovers from server refusal`, async ({ page }) => {
  const fixture = await installAccessFixtures(page);
  await openReal(fixture, '/oauth/consent?authorization_id=synthetic-request');
  await expect(page.getByRole('heading', { name: 'Connect Synthetic read-only assistant?' })).toBeVisible();
  await page.getByRole('button', { name: action === 'approve' ? 'Approve connection' : 'Deny', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: `Synthetic ${action} decision unavailable` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve connection' })).toBeEnabled();
  expect(fixture.requests.find(r => r.path.endsWith('/synthetic-request/consent')).body).toEqual({ action });
});
