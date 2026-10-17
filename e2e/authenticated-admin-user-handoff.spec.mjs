import { test, expect, SYNTHETIC_USER, SECOND_SYNTHETIC_USER } from './fixtures/authenticated-product.mjs';
import { TITLE_ID } from './fixtures/access-product.mjs';
import { adminReadFixtures, installAdminFixtures } from './fixtures/admin-product.mjs';

const writes = fixture => fixture.requests.filter(row => !['GET', 'HEAD', 'OPTIONS'].includes(row.method)
  && !(row.path === '/api/auth/session' && row.method === 'POST' && row.body?.action === 'refresh'));
const lookupReads = fixture => fixture.requests.filter(row => row.path === '/api/v1/admin/users/lookup');
const form = page => page.getByRole('form', { name: 'Find a user', exact: true });

test('Appeal Open account carries its exact user into an inert ledger lookup', async ({ page }) => {
  const fixture = await installAdminFixtures(page);
  await fixture.open('/app/admin/appeals');
  await page.getByRole('link', { name: 'Open account', exact: true }).click();
  await expect(form(page).getByRole('textbox')).toHaveValue(SYNTHETIC_USER.id);
  expect(lookupReads(fixture)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Grant credits', exact: true })).toHaveCount(0);
  await form(page).getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(form(page).getByRole('textbox')).toHaveValue('');
  expect(writes(fixture)).toEqual([]);
});

test('Report open account carries its owner into an inert violations lookup without opening takedown', async ({ page }) => {
  const reports = adminReadFixtures()['/admin/reports'];
  const fixture = await installAdminFixtures(page, { reads: { '/admin/reports': { ...reports, reports: reports.reports.map(row => ({ ...row, subject_kind: 'job', subject_id: TITLE_ID, subject_user_id: SYNTHETIC_USER.id })) } } });
  await fixture.open('/app/admin/reports');
  await page.getByRole('link', { name: 'open account', exact: true }).click();
  await expect(form(page).getByRole('textbox')).toHaveValue(SYNTHETIC_USER.id);
  expect(lookupReads(fixture)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Take down', exact: true })).toHaveCount(0);
  await expect(page.getByRole('form', { name: 'Record a takedown', exact: true })).toHaveCount(0);
  expect(writes(fixture)).toEqual([]);
});

test('Isolated delayed grant completion cannot revive a cleared ledger or start another account read', async ({ page }) => {
  let release, started = false;
  const gate = new Promise(resolve => { release = resolve; });
  const fixture = await installAdminFixtures(page, { routes: async args => {
    if (args.url.pathname !== '/api/v1/admin/users/ledger' || args.method !== 'POST') return false;
    expect(args.body).toEqual({ user_id: SYNTHETIC_USER.id, credits: 1, reason: 'Synthetic delayed completion only' });
    started = true; await gate;
    return args.json({ replayed: false, credits_delta: 1, balance_after: 1001 });
  } });
  try {
    await fixture.open(`/app/admin/users?user=${SYNTHETIC_USER.id}`);
    await form(page).getByRole('button', { name: 'Find', exact: true }).click();
    await expect(page.getByText('Synthetic existing credit movement', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Grant credits', exact: true }).click();
    const grant = page.getByRole('form', { name: 'Grant credits', exact: true });
    await grant.getByRole('spinbutton').fill('1');
    await grant.getByRole('textbox').fill('Synthetic delayed completion only');
    const finished = page.waitForResponse(response => response.url().endsWith('/api/v1/admin/users/ledger') && response.request().method() === 'POST');
    await grant.getByRole('button', { name: 'Grant 1 credits', exact: true }).click();
    await expect.poll(() => started).toBe(true);
    await form(page).getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(form(page).getByRole('textbox')).toHaveValue('');
    const reads = fixture.requests.filter(row => row.path === '/api/v1/admin/users/ledger' && row.method === 'GET').length;
    release(); await (await finished).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect.poll(() => writes(fixture).length).toBe(1);
    expect(fixture.requests.filter(row => row.path === '/api/v1/admin/users/ledger' && row.method === 'GET')).toHaveLength(reads);
    await expect(page.getByText('Synthetic existing credit movement', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Ledger, newest first', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: SYNTHETIC_USER.email, exact: true })).toHaveCount(0);
  } finally { release(); }
});

test('Violations scoped record rerender preserves exactly one account card and Clear removes it', async ({ page }) => {
  let release, started = false;
  const gate = new Promise(resolve => { release = resolve; });
  const fixture = await installAdminFixtures(page, { routes: async args => {
    if (args.method !== 'GET' || args.url.pathname !== '/api/v1/admin/violations' || args.url.searchParams.get('user_id') !== SYNTHETIC_USER.id) return false;
    started = true; await gate;
    return args.json({ violations: [] });
  } });
  try {
    await fixture.open(`/app/admin/violations?user=${SYNTHETIC_USER.id}`);
    await form(page).getByRole('button', { name: 'Find', exact: true }).click();
    await expect.poll(() => started).toBe(true);
    const account = page.getByRole('heading', { name: SYNTHETIC_USER.email, exact: true });
    await expect(account).toHaveCount(1);
    release();
    await expect(form(page).getByRole('button', { name: 'Find', exact: true })).toBeEnabled();
    await expect(account).toHaveCount(1);
    await expect(account).toBeVisible();
    await form(page).getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(account).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Record a warning', exact: true })).toHaveCount(0);
    expect(writes(fixture)).toEqual([]);
  } finally { release(); }
});

for (const kind of ['users', 'violations']) {
  test(`${kind} malformed and duplicate handoffs stay empty with no implicit lookup or write`, async ({ page }) => {
    const fixture = await installAdminFixtures(page);
    for (const query of ['user=', 'user=%3Cscript%3E', `user=${SYNTHETIC_USER.id}&user=${SYNTHETIC_USER.id}`, `user=${'x'.repeat(255)}`]) {
      await fixture.open(`/app/admin/${kind}?${query}`);
      await expect(form(page).getByRole('textbox')).toHaveValue('');
      await expect(form(page).getByRole('button', { name: 'Find', exact: true })).toBeDisabled();
    }
    expect(lookupReads(fixture)).toEqual([]); expect(writes(fixture)).toEqual([]);
  });

  test(`${kind} accepts a QA email handoff, requires Find, and clears all account action surfaces`, async ({ page }) => {
    const fixture = await installAdminFixtures(page);
    await fixture.open(`/app/admin/${kind}?user=${encodeURIComponent(SYNTHETIC_USER.email)}`);
    await expect(form(page).getByRole('textbox')).toHaveValue(SYNTHETIC_USER.email);
    expect(lookupReads(fixture)).toEqual([]);
    await form(page).getByRole('button', { name: 'Find', exact: true }).click();
    await expect(page.getByRole('heading', { name: SYNTHETIC_USER.email, exact: true })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: SYNTHETIC_USER.email, exact: true })).toBeVisible();
    if (kind === 'violations') await expect(page.getByRole('form', { name: 'Record a takedown', exact: true })).toHaveCount(0);
    await form(page).getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(form(page).getByRole('textbox')).toHaveValue('');
    await expect(page.getByRole('heading', { name: SYNTHETIC_USER.email, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: kind === 'users' ? 'Grant credits' : 'Take down', exact: true })).toHaveCount(0);
    expect(writes(fixture)).toEqual([]);
  });

  test(`${kind} a changed signed-in account discards the previous lookup and action forms`, async ({ page }) => {
    const fixture = await installAdminFixtures(page);
    await fixture.open(`/app/admin/${kind}?user=${SYNTHETIC_USER.id}`);
    await form(page).getByRole('button', { name: 'Find', exact: true }).click();
    await expect(page.getByRole('heading', { name: SYNTHETIC_USER.email, exact: true })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: SYNTHETIC_USER.email, exact: true })).toBeVisible();
    await fixture.switchUser(SECOND_SYNTHETIC_USER);
    await expect(page.getByRole('heading', { name: SYNTHETIC_USER.email, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: kind === 'users' ? 'Grant credits' : 'Take down', exact: true })).toHaveCount(0);
    expect(writes(fixture)).toEqual([]);
  });

  for (const code of ['mfa_required', 'not_admin']) test(`${kind} handoff still requires authorized, MFA-unlocked manual lookup: ${code}`, async ({ page }) => {
    const fixture = await installAdminFixtures(page, { scenario: { adminError: code } });
    await fixture.open(`/app/admin/${kind}?user=${SYNTHETIC_USER.id}`);
    await expect(form(page).getByRole('textbox')).toHaveValue(SYNTHETIC_USER.id);
    expect(lookupReads(fixture)).toEqual([]);
    await form(page).getByRole('button', { name: 'Find', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: code === 'mfa_required' ? 'Unlock this session' : 'not an administrator' })).toBeVisible();
    await expect(page.getByRole('heading', { name: SYNTHETIC_USER.email, exact: true })).toHaveCount(0);
    expect(writes(fixture)).toEqual([]);
  });
}
