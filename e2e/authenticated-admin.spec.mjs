import { test, expect, SYNTHETIC_USER } from './fixtures/authenticated-product.mjs';
import { ACTION_ID, TITLE_ID } from './fixtures/access-product.mjs';
import { ADMIN_IDS, adminReadFixtures, installAdminFixtures } from './fixtures/admin-product.mjs';

const writes = fixture => fixture.requests.filter(row => !['GET', 'HEAD', 'OPTIONS'].includes(row.method)
  && !(row.path === '/api/auth/session' && row.method === 'POST' && row.body?.action === 'refresh'));
const adminWrites = fixture => writes(fixture).filter(row => row.path.startsWith('/api/v1/admin/'));
const endpoint = (args, path, method = 'POST') => args.url.origin === args.origin && args.url.pathname === `/api/v1/admin${path}` && args.method === method;
const reason = 'Synthetic isolated review only';
async function open(fixture, path) { expect((await fixture.open(`/app/admin${path}`)).status()).toBe(200); }
async function findQa(page) {
  const form = page.getByRole('form', { name: 'Find a user', exact: true });
  await form.getByRole('textbox').fill(SYNTHETIC_USER.email);
  await form.getByRole('button', { name: 'Find', exact: true }).click();
}

test('Admin Cinema navigation opens the actual publication queue without any decision', async ({ page }) => {
  const fixture = await installAdminFixtures(page);
  await open(fixture, '/cinema');
  await page.getByRole('link', { name: 'Publication queue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cinema publication queue', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic publication submission', exact: true })).toBeVisible();
  expect(writes(fixture)).toEqual([]);
});

test('Admin Security all state filters render historical duplicate labels as distinct rows with GET-only refresh', async ({ page }) => {
  const fixture = await installAdminFixtures(page);
  await open(fixture, '/security');
  const control = page.getByRole('combobox', { name: 'State of SEC-003 admin.mfa_required', exact: true });
  await expect(control).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Latest security events', exact: true })).toBeVisible();
  for (const [name, status, count] of [['Open', 'open', 2], ['Resolved', 'resolved', 1], ['False positive', 'false_positive', 1], ['Active', '', 2]]) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(control).toHaveCount(count);
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => fixture.requests.some(row => row.path === '/api/v1/admin/security' && new URLSearchParams(row.query).get('status') === (status || null))).toBe(true);
  }
  const count = fixture.requests.filter(row => row.path === '/api/v1/admin/security').length;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => fixture.requests.filter(row => row.path === '/api/v1/admin/security').length).toBeGreaterThan(count);
  expect(writes(fixture)).toEqual([]);
});

for (const [code, copy] of [['not_admin', /not an administrator/], ['mfa_required', /Unlock this session with your authenticator/], ['rate_limited', /Too many requests/], ['access_required', /unavailable right now/]]) {
  test(`Admin Security ${code} conceals authorized alert data and recovers through GET refresh`, async ({ page }) => {
    const fixture = await installAdminFixtures(page, { scenario: { adminError: code } });
    await open(fixture, '/security');
    await expect(page.getByRole('alert').filter({ hasText: copy })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Latest security events' })).toHaveCount(0);
    await expect(page.getByRole('combobox')).toHaveCount(0);
    fixture.scenario.adminError = null;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'State of SEC-003 admin.mfa_required', exact: true })).toHaveCount(2);
    expect(writes(fixture)).toEqual([]);
  });
}

test('Admin Security unavailable read retries without rendering stale or private error text', async ({ page }) => {
  const fixture = await installAdminFixtures(page, { scenario: { adminFailures: 1 } });
  await open(fixture, '/security');
  await expect(page.getByRole('alert').filter({ hasText: 'Security alerts are unavailable right now.' })).toHaveText('Security alerts are unavailable right now. Please retry.');
  await expect(page.getByRole('heading', { name: 'Alerts', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alerts', exact: true })).toBeVisible();
  expect(writes(fixture)).toEqual([]);
});

test('Admin Security late earlier read cannot replace the newest filtered result', async ({ page }) => {
  let start = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  const fixture = await installAdminFixtures(page, { routes: async args => {
    if (endpoint(args, '/security', 'GET') && !args.url.searchParams.has('status') && !start) {
      start = true;
      await gate;
      return args.json(adminReadFixtures()['/admin/security']);
    }
    return false;
  } });
  try {
    await open(fixture, '/security');
    await expect.poll(() => start).toBe(true);
    await page.getByRole('tab', { name: 'Resolved', exact: true }).click();
    await expect(page.getByText('Resolved synthetic alert', { exact: true })).toBeVisible();
    release();
    await expect.poll(() => fixture.requests.filter(row => row.path === '/api/v1/admin/security').length).toBe(2);
    await expect(page.getByText('Historical synthetic alert', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Resolved', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(writes(fixture)).toEqual([]);
  } finally { release(); }
});

test('Admin Security duplicate-label triage sends only the chosen alert ID and handles refusal before retry', async ({ page }) => {
  let attempts = 0;
  let projection = adminReadFixtures()['/admin/security'];
  const fixture = await installAdminFixtures(page, { reads: { '/admin/security': () => projection }, routes: args => {
    if (!endpoint(args, '/security')) return false;
    expect(args.body).toEqual({ alert_id: ADMIN_IDS.duplicateAlert, status: 'investigating' });
    if (++attempts === 1) return args.json({ error: 'rate_limited' }, 429);
    projection = { ...projection, alerts: projection.alerts.map(row => row.id === ADMIN_IDS.duplicateAlert ? { ...row, status: 'investigating' } : row) };
    return args.json({ status: 'investigating', unchanged: false });
  } });
  await open(fixture, '/security');
  const controls = page.getByRole('combobox', { name: 'State of SEC-003 admin.mfa_required', exact: true });
  await expect(controls).toHaveCount(2);
  await controls.nth(1).selectOption('investigating');
  await expect(page.getByRole('alert').filter({ hasText: 'Too many requests.' })).toHaveText('Too many requests. Wait a minute and try again.');
  await expect(controls.nth(0)).toHaveValue('open');
  await expect(controls.nth(1)).toHaveValue('open');
  await controls.nth(1).selectOption('investigating');
  await expect(controls.nth(1)).toHaveValue('investigating');
  await expect(controls.nth(0)).toHaveValue('open');
  expect(adminWrites(fixture).map(row => row.body.alert_id)).toEqual([ADMIN_IDS.duplicateAlert, ADMIN_IDS.duplicateAlert]);
});

const populated = [
  ['', 'synthetic-model'], ['/violations', 'Synthetic existing warning'], ['/appeals', 'Synthetic appeal statement'],
  ['/reports', 'Synthetic report details, no real content'], ['/webhooks', 'synthetic-stuck-event'],
  ['/cinema', 'Synthetic creator application, no identity document'], ['/cinema/submissions', 'Synthetic publication submission'],
  ['/cinema/comments', 'Synthetic held comment'], ['/cinema/voting', 'Synthetic held vote'],
  ['/cinema/story-polls', 'Synthetic held story choice'], ['/cinema/rankings', 'Synthetic ranked film'],
];
for (const [path, label] of populated) test(`Admin populated ${path || '/'} renders bounded authorized records without writes`, async ({ page }) => {
  const fixture = await installAdminFixtures(page); await open(fixture, path);
  await expect(page.getByText(label, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth))).toBeLessThanOrEqual(2);
  expect(writes(fixture)).toEqual([]);
});

test('Admin account populated ledger permits cancel and protects grant replay identity in isolated failures', async ({ page }) => {
  let attempts = 0;
  const fixture = await installAdminFixtures(page, { routes: args => {
    if (!endpoint(args, '/users/ledger')) return false;
    expect(args.body).toEqual({ user_id: SYNTHETIC_USER.id, credits: 5, reason });
    return ++attempts === 1 ? args.json({ error: 'synthetic_unavailable' }, 503) : args.json({ replayed: true, credits_delta: 5, balance_after: 1005 });
  } });
  await open(fixture, '/users'); await findQa(page);
  await expect(page.getByText('Synthetic existing credit movement', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Grant credits', exact: true }).click();
  let form = page.getByRole('form', { name: 'Grant credits', exact: true });
  await expect(form.getByRole('button', { name: /^Grant .*credits$/ })).toBeDisabled();
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes(fixture)).toEqual([]);
  await page.getByRole('button', { name: 'Grant credits', exact: true }).click();
  form = page.getByRole('form', { name: 'Grant credits', exact: true });
  await form.getByRole('spinbutton').fill('5'); await form.getByRole('textbox').fill(reason);
  await form.getByRole('button', { name: 'Grant 5 credits', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await form.getByRole('button', { name: 'Grant 5 credits', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'already recorded' })).toBeVisible();
  const rows = adminWrites(fixture); expect(rows).toHaveLength(2);
  expect(rows[0].idempotencyKey).toMatch(/^[a-f0-9-]{36}$/); expect(rows[1].idempotencyKey).toBe(rows[0].idempotencyKey);
});

test('Admin account isolated clawback sends negative Pack magnitude and preserves balance after refusal', async ({ page }) => {
  const fixture = await installAdminFixtures(page, { routes: args => {
    if (!endpoint(args, '/users/ledger')) return false;
    expect(args.body).toEqual({ user_id: SYNTHETIC_USER.id, credits: -5, reason });
    return args.json({ error: 'insufficient_pack_credits' }, 400);
  } });
  await open(fixture, '/users'); await findQa(page);
  await page.getByRole('button', { name: 'Take back credits', exact: true }).click();
  const form = page.getByRole('form', { name: 'Take back credits', exact: true });
  await expect(form).toContainText('Pack cap: 700');
  await form.getByRole('spinbutton').fill('5'); await form.getByRole('textbox').fill(reason);
  await form.getByRole('button', { name: 'Take back 5 credits', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  expect(adminWrites(fixture)).toHaveLength(1);
  expect(fixture.state.balance).toBe(1000);
});

test('Admin report resolve validates locally, cancels without write and submits only its synthetic target', async ({ page }) => {
  const fixture = await installAdminFixtures(page, { routes: args => {
    if (!endpoint(args, '/reports')) return false;
    expect(args.body).toEqual({ report_id: ADMIN_IDS.report, resolution: reason });
    return args.json({ error: 'synthetic_unavailable' }, 503);
  } });
  await open(fixture, '/reports');
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  let form = page.getByRole('form', { name: 'Resolve this report', exact: true });
  await expect(form.getByRole('button', { name: 'Close report', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(writes(fixture)).toEqual([]);
  await page.getByRole('button', { name: 'Resolve', exact: true }).click(); form = page.getByRole('form', { name: 'Resolve this report', exact: true });
  await form.getByRole('textbox').fill(reason); await form.getByRole('button', { name: 'Close report', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible(); expect(adminWrites(fixture)).toHaveLength(1);
});

test('Admin Cinema publication safety disables approval while rejection stays fixture-only', async ({ page }) => {
  const data = adminReadFixtures()['/admin/cinema/submissions'];
  const fixture = await installAdminFixtures(page, { reads: { '/admin/cinema/submissions': { submissions: data.submissions.map(row => ({ ...row, malware_status: 'unavailable' })) } }, routes: args => {
    if (!endpoint(args, '/cinema/submissions')) return false;
    expect(args.body).toEqual({ submission_id: ADMIN_IDS.submission, decision: 'rejected', reason });
    return args.json({ error: 'already_reviewed' }, 409);
  } });
  await open(fixture, '/cinema/submissions');
  const item = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Synthetic publication submission', exact: true }) });
  // Playwright's disabled matcher follows this option's enclosing label to
  // the enabled select. Assert the actual native option gate, not its parent.
  await expect(item.getByRole('option', { name: 'Approve and publish', exact: true })).toHaveJSProperty('disabled', true);
  await expect(item.getByRole('status')).toHaveText('Approval is locked until all three checks pass. You can still reject the submission.');
  await item.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('rejected');
  await item.getByLabel('Internal review reason', { exact: true }).fill(reason);
  await item.getByRole('button', { name: 'Save decision', exact: true }).click();
  await expect(item.getByRole('alert')).toContainText('Another reviewer');
  expect(adminWrites(fixture)).toHaveLength(1);
});

test('Admin Cinema suspension cancel does not send a mutation or issue refunds', async ({ page }) => {
  const fixture = await installAdminFixtures(page); await open(fixture, '/cinema/submissions');
  const section = page.getByRole('region', { name: 'Suspend a published title', exact: true });
  await section.getByLabel('Title id', { exact: true }).fill(TITLE_ID); await section.getByLabel('Reason', { exact: true }).fill(reason);
  let dismissed = false;
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('refunded in credits'); await dialog.dismiss(); dismissed = true; });
  await section.getByRole('button', { name: 'Suspend title', exact: true }).click();
  await expect.poll(() => dismissed).toBe(true); expect(writes(fixture)).toEqual([]);
});

test('Admin Cinema rankings preserve independent review and never offer self-publication', async ({ page }) => {
  const fixture = await installAdminFixtures(page); await open(fixture, '/cinema/rankings');
  await expect(page.getByText('Another administrator must review this snapshot.', { exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Approve and publish', exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: '3.50', exact: true })).toBeVisible();
  expect(writes(fixture)).toEqual([]);
});

for (const decision of ['approved', 'rejected']) test(`Admin creator ${decision} decision is intercepted with its exact application and stable retry key`, async ({ page }) => {
  const fixture = await installAdminFixtures(page, { routes: args => {
    if (!endpoint(args, '/cinema/creators')) return false;
    expect(args.body).toEqual({ application_id: ADMIN_IDS.application, decision, reason });
    return args.json({ error: 'already_reviewed' }, 409);
  } });
  await open(fixture, '/cinema');
  const item = page.getByRole('article');
  await item.getByRole('combobox', { name: 'Decision', exact: true }).selectOption(decision);
  await item.getByLabel('Internal review reason', { exact: true }).fill(reason);
  await item.getByRole('button', { name: 'Save decision', exact: true }).click();
  await expect(item.getByRole('alert')).toContainText('Another reviewer');
  await item.getByRole('button', { name: 'Save decision', exact: true }).click();
  await expect.poll(() => adminWrites(fixture).length).toBe(2);
  expect(adminWrites(fixture)[1].idempotencyKey).toBe(adminWrites(fixture)[0].idempotencyKey);
});

for (const decision of ['upheld', 'rejected']) test(`Admin appeal ${decision} validates, cancels and acknowledges only a synthetic decision`, async ({ page }) => {
  const fixture = await installAdminFixtures(page, { routes: args => {
    if (!endpoint(args, '/appeals')) return false;
    expect(args.body).toEqual({ appeal_id: ACTION_ID, decision, reason });
    return args.json({ status: decision, standing_takedowns: 0, email: 'skipped', unfrozen: false });
  } });
  await open(fixture, '/appeals');
  const start = () => page.getByRole('button', { name: decision === 'upheld' ? 'Uphold appeal' : 'Reject appeal', exact: true });
  await start().click();
  let form = page.getByRole('form', { name: `${decision === 'upheld' ? 'Uphold' : 'Reject'} this appeal`, exact: true });
  await form.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(writes(fixture)).toEqual([]);
  await start().click(); form = page.getByRole('form', { name: `${decision === 'upheld' ? 'Uphold' : 'Reject'} this appeal`, exact: true });
  const submit = form.getByRole('button', { name: decision === 'upheld' ? 'Uphold and reverse' : 'Reject appeal', exact: true });
  await expect(submit).toBeDisabled(); await form.getByRole('textbox').fill(reason); await submit.click();
  await expect(page.getByRole('status').filter({ hasText: `Appeal ${decision}` })).toBeVisible();
  expect(adminWrites(fixture)).toHaveLength(1);
});

for (const [tier, trigger, formName, submitName] of [
  ['warning', 'Record a warning', 'Record a warning', 'Record warning'],
  ['takedown', 'Take down', 'Record a takedown', 'Take down'],
  ['csam_escalation', 'Escalate (CSAM)', 'Escalate as CSAM', 'Escalate and freeze'],
]) test(`Admin synthetic ${tier} target is exact; no real content, evidence or notifications are accessed`, async ({ page }) => {
  const fixture = await installAdminFixtures(page, { routes: args => {
    if (!endpoint(args, '/violations')) return false;
    expect(args.body).toEqual({ user_id: SYNTHETIC_USER.id, job_id: tier === 'warning' ? null : TITLE_ID, tier, reason });
    return args.json({ tier, takedowns: tier === 'takedown' ? 1 : 0, assets_removed: 0, preserved: 0, frozen: false, email: 'skipped' });
  } });
  await open(fixture, '/violations'); await findQa(page);
  await page.getByRole('button', { name: trigger, exact: true }).click();
  const form = page.getByRole('form', { name: formName, exact: true });
  await expect(form.getByRole('button', { name: submitName, exact: true })).toBeDisabled();
  await form.getByRole('textbox').fill(reason); await form.getByRole('button', { name: submitName, exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: tier === 'csam_escalation' ? 'Escalated.' : `Recorded ${tier}` })).toBeVisible();
  expect(adminWrites(fixture)).toHaveLength(1);
  expect(fixture.requests.some(row => row.path === '/api/v1/admin/reports/asset')).toBe(false);
});

for (const [action, decision, itemText, submit] of [
  ['review_comment', 'approved', 'Synthetic held comment', 'Save comment decision'],
  ['review_comment', 'rejected', 'Synthetic held comment', 'Save comment decision'],
  ['review_comment', 'removed', 'Synthetic report explanation', 'Remove comment'],
  ['resolve_report', null, 'Synthetic report explanation', 'Resolve report'],
]) test(`Admin comment ${action}/${decision || 'resolve'} stays isolated and survives typed refusal`, async ({ page }) => {
  const fixture = await installAdminFixtures(page, { routes: args => {
    if (!endpoint(args, '/cinema/comments')) return false;
    expect(args.body).toEqual({ action, id: action === 'resolve_report' ? ADMIN_IDS.report : ADMIN_IDS.comment, reason, ...(decision ? { decision } : {}) });
    return args.json({ error: 'recent_mfa_required' }, 403);
  } });
  await open(fixture, '/cinema/comments');
  const item = page.getByRole('article').filter({ has: page.getByText(itemText, { exact: true }) });
  if (decision && decision !== 'removed') await item.getByRole('combobox', { name: 'Decision', exact: true }).selectOption(decision);
  const form = item.locator('form').filter({ has: page.getByRole('button', { name: submit, exact: true }) });
  await form.getByLabel('Internal audit reason', { exact: true }).fill(reason);
  await form.getByRole('button', { name: submit, exact: true }).click();
  await expect(form.getByRole('alert')).toContainText(/authenticator/i); expect(adminWrites(fixture)).toHaveLength(1);
});

for (const [path, action, itemText, button] of [
  ['/cinema/voting', 'review_vote', 'Synthetic held vote', 'Save vote decision'],
  ['/cinema/story-polls', 'review_story_choice', 'Synthetic held story choice', 'Save choice decision'],
]) test(`Admin ${action} validates the held subject and sends only the synthetic decision`, async ({ page }) => {
  const fixture = await installAdminFixtures(page, { routes: args => {
    if (!endpoint(args, path)) return false;
    expect(args.body).toEqual({ action, id: ACTION_ID, reason, decision: 'rejected' });
    return args.json({ error: 'recent_mfa_required' }, 403);
  } });
  await open(fixture, path);
  const item = page.getByRole('article').filter({ has: page.getByRole('heading', { name: itemText, exact: true }) });
  await item.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('rejected');
  await item.getByLabel('Internal audit reason', { exact: true }).fill(reason);
  await item.getByRole('button', { name: button, exact: true }).click();
  await expect(item.getByRole('alert')).toContainText(/authenticator/i); expect(adminWrites(fixture)).toHaveLength(1);
});

test('Admin story-poll creation rejects duplicate choices locally before an intercepted valid request', async ({ page }) => {
  const fixture = await installAdminFixtures(page, { routes: args => {
    if (!endpoint(args, '/cinema/story-polls')) return false;
    expect(args.body.action).toBe('create_story_poll'); expect(args.body.options).toEqual(['Synthetic north', 'Synthetic south']);
    expect(args.body.content_id).toBe(TITLE_ID); expect(args.body.reason).toBe(reason);
    return args.json({ error: 'recent_mfa_required' }, 403);
  } });
  await open(fixture, '/cinema/story-polls');
  const submit = page.getByTestId('story-poll-submit-create_story_poll-new');
  const form = page.locator('form').filter({ has: submit });
  await form.locator('[name="content_id"]').fill(TITLE_ID); await form.locator('[name="question"]').fill('Synthetic direction?');
  await form.locator('[name="opens_at"]').fill('2026-11-01T10:00'); await form.locator('[name="closes_at"]').fill('2026-11-02T10:00');
  await form.locator('[name="options"]').fill('Synthetic north\nsynthetic NORTH'); await form.locator('[name="reason"]').fill(reason);
  await submit.click(); await expect(form.getByRole('alert')).toContainText('different answers'); expect(writes(fixture)).toEqual([]);
  await form.locator('[name="options"]').fill('Synthetic north\nSynthetic south'); await submit.click();
  await expect(form.getByRole('alert')).toContainText(/authenticator/i); expect(adminWrites(fixture)).toHaveLength(1);
});

test('Admin independent ranking publication refusal is isolated and cannot change public winners', async ({ page }) => {
  const data = adminReadFixtures()['/admin/cinema/rankings'];
  const fixture = await installAdminFixtures(page, { reads: { '/admin/cinema/rankings': { ...data, snapshots: data.snapshots.map(row => ({ ...row, own: false })) } }, routes: args => {
    if (!endpoint(args, '/cinema/rankings')) return false;
    expect(args.body).toEqual({ action: 'publish', id: ACTION_ID, reason });
    return args.json({ error: 'self_review_forbidden' }, 403);
  } });
  await open(fixture, '/cinema/rankings');
  const form = page.getByRole('form', { name: 'Review Synthetic provisional ranking', exact: true });
  await form.getByRole('combobox', { name: 'Action', exact: true }).selectOption('publish');
  await form.getByLabel('Internal reason', { exact: true }).fill(reason);
  await form.getByRole('button', { name: 'Save ranking decision', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('separate administrator'); expect(adminWrites(fixture)).toHaveLength(1);
});

for (const [path, action, id, button] of [
  ['/cinema/voting', 'close_competition', ADMIN_IDS.competition, 'Close competition'],
  ['/cinema/story-polls', 'close_story_poll', ADMIN_IDS.poll, 'Close story poll'],
]) test(`Admin ${action} sends only an isolated audited command`, async ({ page }) => {
  const fixture = await installAdminFixtures(page, { routes: args => {
    if (!endpoint(args, path)) return false;
    expect(args.body).toEqual({ action, id, reason });
    return args.json({ error: 'recent_mfa_required' }, 403);
  } });
  await open(fixture, path);
  const submit = page.getByRole('button', { name: button, exact: true });
  const form = page.locator('form').filter({ has: submit });
  await form.getByLabel('Internal audit reason', { exact: true }).fill(reason); await submit.click();
  await expect(form.getByRole('alert')).toContainText(/authenticator/i); expect(adminWrites(fixture)).toHaveLength(1);
});

test('Admin competition creation requires an eligible type before any intercepted request', async ({ page }) => {
  const fixture = await installAdminFixtures(page, { routes: args => {
    if (!endpoint(args, '/cinema/voting')) return false;
    expect(args.body).toMatchObject({ action: 'create_competition', name: 'Synthetic new competition', target_types: ['FILM'], reason });
    expect(Date.parse(args.body.ends_at)).toBeGreaterThan(Date.parse(args.body.starts_at));
    return args.json({ error: 'recent_mfa_required' }, 403);
  } });
  await open(fixture, '/cinema/voting');
  const submit = page.getByRole('button', { name: 'Create competition', exact: true });
  const form = page.locator('form').filter({ has: submit });
  await form.getByLabel('Competition name', { exact: true }).fill('Synthetic new competition');
  await form.locator('[name="starts_at"]').fill('2026-11-01T10:00'); await form.locator('[name="ends_at"]').fill('2026-11-02T10:00');
  await form.getByLabel('Internal audit reason', { exact: true }).fill(reason);
  await submit.click(); await expect(form.getByRole('alert')).toContainText('Select at least one content type'); expect(writes(fixture)).toEqual([]);
  await form.getByRole('checkbox', { name: 'FILM', exact: true }).check(); await submit.click();
  await expect(form.getByRole('alert')).toContainText(/authenticator/i); expect(adminWrites(fixture)).toHaveLength(1);
});

test('Admin provisional ranking preparation cannot bypass a held-vote refusal', async ({ page }) => {
  const fixture = await installAdminFixtures(page, { routes: args => {
    if (!endpoint(args, '/cinema/rankings')) return false;
    expect(args.body).toEqual({ action: 'prepare', id: ADMIN_IDS.competition, reason });
    return args.json({ error: 'votes_need_review' }, 409);
  } });
  await open(fixture, '/cinema/rankings');
  const form = page.getByRole('form', { name: 'Review Synthetic closed week', exact: true });
  await form.getByLabel('Internal reason', { exact: true }).fill(reason);
  await form.getByRole('button', { name: 'Save ranking decision', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Review held votes'); expect(adminWrites(fixture)).toHaveLength(1);
});

test('Admin otherwise-safe publication approval preserves the backend self-review refusal in fixtures only', async ({ page }) => {
  const fixture = await installAdminFixtures(page, { routes: args => {
    if (!endpoint(args, '/cinema/submissions')) return false;
    expect(args.body).toEqual({ submission_id: ADMIN_IDS.submission, decision: 'approved', reason });
    return args.json({ error: 'self_review_forbidden' }, 403);
  } });
  await open(fixture, '/cinema/submissions');
  const item = page.getByRole('article');
  await expect(item.getByRole('option', { name: 'Approve and publish', exact: true })).toHaveJSProperty('disabled', false);
  await item.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('approved');
  await item.getByLabel('Internal review reason', { exact: true }).fill(reason);
  await item.getByRole('button', { name: 'Save decision', exact: true }).click();
  await expect(item.getByRole('alert')).toContainText('cannot review your own title'); expect(adminWrites(fixture)).toHaveLength(1);
});

test('Admin confirmed suspension uses only a synthetic title and zero-refund acknowledgment', async ({ page }) => {
  const fixture = await installAdminFixtures(page, { routes: args => {
    if (!endpoint(args, '/cinema/suspend')) return false;
    expect(args.body).toEqual({ content_id: TITLE_ID, reason });
    return args.json({ unlocks_reversed: 0, credits_returned: 0 });
  } });
  await open(fixture, '/cinema/submissions');
  const section = page.getByRole('region', { name: 'Suspend a published title', exact: true });
  await section.getByLabel('Title id', { exact: true }).fill(TITLE_ID); await section.getByLabel('Reason', { exact: true }).fill(reason);
  page.once('dialog', async dialog => { expect(dialog.type()).toBe('confirm'); await dialog.accept(); });
  await section.getByRole('button', { name: 'Suspend title', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('0 Unlock(s) reversed, 0 credits returned'); expect(adminWrites(fixture)).toHaveLength(1);
});

for (const disarm of [true, false]) test(`Admin scanner ${disarm ? 'disarm' : 'hold release'} is isolated, reasoned and preserves backend refusal`, async ({ page }) => {
  const reports = adminReadFixtures()['/admin/reports'];
  const fixture = await installAdminFixtures(page, { reads: { '/admin/reports': { ...reports, reports: [{ ...reports.reports[0], source: 'scanner', held: true, subject_kind: 'job', subject_id: TITLE_ID, scores: { synthetic: 0 } }] } }, routes: args => {
    if (!endpoint(args, '/reports')) return false;
    expect(args.body).toEqual({ ...(disarm ? { scanner_disarm: true } : { release_job_id: TITLE_ID }), reason });
    return args.json({ error: 'not_admin' }, 403);
  } });
  await open(fixture, '/reports');
  const input = page.getByRole('textbox', { name: disarm ? 'Reason for disarming monitoring' : 'Reason for releasing hold', exact: true });
  const form = page.locator('form').filter({ has: input });
  const submit = form.getByRole('button', { name: disarm ? 'Scanner: disarm monitoring' : 'Release', exact: true });
  await expect(submit).toBeDisabled(); await input.fill(reason); await submit.click();
  await expect(form.locator('..').getByRole('alert')).toContainText('not an administrator');
  expect(adminWrites(fixture)).toHaveLength(1); expect(fixture.requests.some(row => row.path === '/api/v1/admin/reports/asset')).toBe(false);
});

test('Admin evidence hold release cancels locally then sends only the synthetic action on explicit submission', async ({ page }) => {
  const data = adminReadFixtures()['/admin/users/ledger'];
  const fixture = await installAdminFixtures(page, { reads: { '/admin/users/ledger': { ...data, actions: data.actions.map(row => ({ ...row, action: 'csam_escalation', reason: 'Synthetic audit hold; no content attached' })) } }, routes: args => {
    if (!endpoint(args, '/reports')) return false;
    expect(args.body).toEqual({ release_action_id: ACTION_ID, reason });
    return args.json({ error: 'not_admin' }, 403);
  } });
  await open(fixture, '/users'); await findQa(page);
  const button = () => page.getByRole('button', { name: 'Release evidence', exact: true });
  await button().click(); let form = page.getByRole('form', { name: 'Release evidence hold', exact: true });
  await form.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(writes(fixture)).toEqual([]);
  await button().click(); form = page.getByRole('form', { name: 'Release evidence hold', exact: true });
  await form.getByRole('textbox').fill(reason); await form.getByRole('button', { name: 'Release', exact: true }).click();
  await expect(page.getByText('This account is not an administrator.', { exact: true })).toBeVisible(); expect(adminWrites(fixture)).toHaveLength(1);
});
