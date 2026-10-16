import { test, expect } from './fixtures/authenticated-product.mjs';
import { installPublishFixtures, BRAND, SECOND_BRAND, LINK } from './fixtures/authenticated-publish.mjs';
import { decodeActivityCursor } from '../lib/social/activityCursor.js';

// Each route must return real built HTML AND finish an authenticated API read;
// a heading on an anonymous, loading, upgrade or error shell is not a pass.
const interiors = [
  ['', 'Veyrnox Publish', '/accounts', /Create a post/],
  ['/activity', 'Activity', '/activity', /No brand activity has been recorded yet/],
  ['/ads', 'Ads', '/ads', /New campaign draft/],
  ['/analytics', 'Analytics', '/accounts', /No accounts connected yet/],
  ['/autolists', 'RSS Autolists', '/autolists', /Connect a feed/],
  ['/calendar', 'Publishing calendar', '/calendar', /Today/],
  ['/commerce', 'Commerce', '/commerce/products', /New product/],
  ['/contacts', 'Contacts', '/contacts', /No contacts yet/],
  ['/developer', 'Developer tools', '/developer/keys', /Create API key/],
  ['/inbox', 'Inbox', '/inbox', /Nothing in this view/],
  ['/plan', 'Plans and billing', '/plan', /Publish Plan/],
  ['/queues', 'Posting queues', '/queues', /Create queue/],
  ['/reports', 'Reports', '/reports', /New report template/],
  ['/smartlink', 'SmartLink', '/smartlink', /Save SmartLink/],
  ['/team', 'Team', '/team', /Invite a team member/],
  ['/workflows', 'Inbox workflows', '/workflows', /New workflow/],
];
for (const [suffix, heading, api, interior] of interiors) test(`Publish ${suffix || 'home'} authenticated interior hydrates with synthetic APIs`, async ({ page }) => {
  const fixture = await installPublishFixtures(page);
  const response = await fixture.open(`/app/publish${suffix}`); expect(response.status()).toBe(200);
  await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
  await expect.poll(() => fixture.requests.some(row => row.path === `/api/v1/social${api}`)).toBe(true);
  await expect(page.getByText(interior).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
  // Next's empty route-announcer has role=alert even on healthy pages.
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
  if (suffix === '/ads') {
    await page.getByLabel('Campaign name', { exact: true }).fill('Synthetic campaign draft');
    await page.getByRole('combobox', { name: 'Campaign type', exact: true }).selectOption('boost');
    await expect(page.getByRole('combobox', { name: 'Published post', exact: true })).toBeVisible();
  } else if (suffix === '/commerce') {
    await page.getByRole('button', { name: 'Add variant', exact: true }).click();
    await page.getByLabel('Variant 1 title', { exact: true }).fill('Synthetic size');
    await page.getByLabel('Variant 1 price', { exact: true }).fill('12.34');
    await page.getByRole('button', { name: 'Remove variant 1', exact: true }).click();
    await expect(page.getByLabel('Variant 1 title', { exact: true })).toHaveCount(0);
  } else if (suffix === '/contacts') {
    await page.getByRole('combobox', { name: 'Network', exact: true }).selectOption('youtube');
    await expect.poll(() => fixture.requests.some(row => row.path.endsWith('/contacts') && new URLSearchParams(row.query).get('network') === 'youtube')).toBe(true);
  } else if (suffix === '/developer') {
    await page.getByLabel('Search', { exact: true }).fill('synthetic-filter');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect.poll(() => fixture.requests.some(row => row.path.endsWith('/developer/logs') && new URLSearchParams(row.query).get('q') === 'synthetic-filter')).toBe(true);
  } else if (suffix === '/inbox') {
    await page.getByLabel('Search', { exact: true }).fill('synthetic-search');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => fixture.requests.some(row => row.path.endsWith('/inbox') && new URLSearchParams(row.query).get('search') === 'synthetic-search')).toBe(true);
  } else if (suffix === '/calendar') {
    await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('scheduled');
    await expect.poll(() => fixture.requests.some(row => row.path.endsWith('/calendar') && new URLSearchParams(row.query).get('status') === 'scheduled')).toBe(true);
  } else if (suffix === '/plan') {
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Cancel plan', exact: true }).click();
    expect(fixture.requests.filter(row => row.path.endsWith('/plan/cancel'))).toEqual([]);
  } else if (suffix === '/queues') {
    await page.getByRole('button', { name: 'Add time', exact: true }).click();
    await page.getByLabel('Time 2', { exact: true }).fill('14:30');
    await expect(page.getByLabel('Time 2', { exact: true })).toHaveValue('14:30');
  } else if (suffix === '/reports') {
    await page.getByLabel('Template name', { exact: true }).fill('Synthetic report');
    await page.getByRole('combobox', { name: 'Period', exact: true }).selectOption('7');
    await expect(page.getByRole('combobox', { name: 'Period', exact: true })).toHaveValue('7');
  } else if (suffix === '/team') {
    await page.getByLabel('Email', { exact: true }).fill('invalid-address');
    await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
    expect(fixture.requests.filter(row => row.path.endsWith('/team') && row.method === 'POST')).toEqual([]);
  }
});

test('SmartLink unavailable initial read stays fail-closed and recovers by read-only retry', async ({ page }) => {
  let failing = true; const fixture = await installPublishFixtures(page, { routes: ({ url, method, json }) => url.pathname === '/api/v1/social/smartlink' && method === 'GET' && failing ? json({ error: 'synthetic_unavailable' }, 503) : false });
  await fixture.open('/app/publish/smartlink'); await expect(page.getByText('Could not load your SmartLink. Try again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save SmartLink', exact: true })).toHaveCount(0); await expect(page.getByLabel('Title', { exact: true })).toHaveCount(0);
  failing = false; await page.getByRole('button', { name: 'Try again', exact: true }).click(); await expect(page.getByLabel('Title', { exact: true })).toHaveValue(LINK.smartlink.title); expect(fixture.writes).toEqual([]);
});
test('SmartLink unknown role cannot write an otherwise loaded document', async ({ page }) => {
  const fixture = await installPublishFixtures(page, { role: null }); await fixture.open('/app/publish/smartlink');
  await expect(page.getByLabel('Title', { exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Save SmartLink', exact: true })).toHaveCount(0); expect(fixture.writes).toEqual([]);
});
test('SmartLink edits save an unpublished synthetic page with its selected brand snapshot', async ({ page }) => {
  const fixture = await installPublishFixtures(page); await fixture.open('/app/publish/smartlink');
  await page.getByLabel('Title', { exact: true }).fill('Edited synthetic title'); await page.getByRole('button', { name: 'Add link', exact: true }).click();
  await page.getByLabel('Link 2 label', { exact: true }).fill('Second synthetic link'); await page.getByLabel('Link 2 URL', { exact: true }).fill('https://example.invalid/second');
  await page.getByRole('button', { name: 'Save SmartLink', exact: true }).click(); await expect(page.getByRole('status')).toHaveText('SmartLink saved.');
  expect(fixture.writes).toHaveLength(1); expect(fixture.writes[0].brand).toBe(BRAND); expect(fixture.writes[0].body.published).toBe(false); expect(fixture.writes[0].body.items).toHaveLength(2);
});
test('SmartLink readback failure retains edited title and every destination', async ({ page }) => {
  let reads = 0; const fixture = await installPublishFixtures(page, { routes: ({ url, method, json }) => url.pathname === '/api/v1/social/smartlink' && method === 'GET' && ++reads > 1 ? json({ error: 'synthetic_unavailable' }, 503) : false });
  await fixture.open('/app/publish/smartlink'); await page.getByLabel('Title', { exact: true }).fill('Preserved edit'); await page.getByRole('button', { name: 'Save SmartLink', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Could not save your SmartLink'); await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Preserved edit'); await expect(page.getByLabel('Link 1 label', { exact: true })).toHaveValue('Synthetic destination'); expect(fixture.writes).toHaveLength(1);
});
test('SmartLink ignores a pending default-brand response when the shell selects its initial brand', async ({ page }) => {
  let releaseBrands; const brandsReady = new Promise(resolve => { releaseBrands = resolve; });
  let releaseOld; const oldReady = new Promise(resolve => { releaseOld = resolve; }); let oldStarted = false;
  const fixture = await installPublishFixtures(page, { preselect: false, routes: async ({ url, method, request, json }) => {
    if (url.pathname === '/api/v1/social/brands') { await brandsReady; return json({ brands: [{ id: SECOND_BRAND, label: 'Selected synthetic brand', role: 'owner' }] }); }
    if (url.pathname === '/api/v1/social/smartlink' && method === 'GET') {
      if (!request.headers()['x-publish-brand-id']) { oldStarted = true; await oldReady; return json(LINK); }
      return json({ ...LINK, smartlink: { ...LINK.smartlink, title: 'Selected brand title' } });
    }
    return false;
  } });
  await fixture.open('/app/publish/smartlink'); await expect.poll(() => oldStarted).toBe(true); releaseBrands();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Selected brand title'); releaseOld();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Selected brand title'); await page.getByRole('button', { name: 'Save SmartLink', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('SmartLink saved.'); expect(fixture.writes[0].brand).toBe(SECOND_BRAND);
});

for (const mode of ['Post now', 'Schedule post', 'Send for approval']) test(`Composer ${mode} dispatches only an intercepted synthetic contract`, async ({ page }) => {
  const job = '00000000-0000-4000-8000-000000000051';
  const destination = { id: '00000000-0000-4000-8000-000000000052', network: 'facebook', display_name: 'Synthetic destination', external_account_id: 'synthetic-destination', status: 'active', supportedMedia: ['image'] };
  const submissions = [];
  const fixture = await installPublishFixtures(page, { accounts: [destination], accountFlags: { approvalsEnabled: true }, routes: ({ url, method, body, json }) => {
    if (url.pathname === `/api/v1/jobs/${job}/asset`) return json({ mime_type: 'image/png', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' });
    if (method === 'POST' && ['/api/v1/social/posts', '/api/v1/social/approvals'].includes(url.pathname)) { submissions.push({ path: url.pathname, body }); return json({ post_id: 'synthetic-post', target_count: 1, review_links: [] }); }
    return false;
  } });
  await fixture.open(`/app/publish?job=${job}`);
  await page.getByRole('button', { name: 'Facebook: Synthetic destination', exact: true }).click();
  await page.getByLabel('Caption', { exact: true }).fill('Synthetic test only — no external delivery');
  if (mode === 'Send for approval') await page.getByLabel('Reviewers', { exact: true }).fill('synthetic-reviewer@example.invalid');
  await page.getByRole('button', { name: mode, exact: true }).click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0].body.accountIds).toEqual([destination.id]); expect(submissions[0].body.media).toEqual([{ mediaType: 'image', jobId: job }]);
  if (mode === 'Post now') expect(submissions[0].body.publishNow).toBe(true);
  else expect(new Date(submissions[0].body.scheduledAt).getTime()).toBeGreaterThan(Date.now());
  if (mode === 'Send for approval') { expect(submissions[0].path).toBe('/api/v1/social/approvals'); expect(submissions[0].body.reviewers).toEqual(['synthetic-reviewer@example.invalid']); }
  await expect(page.getByText(mode === 'Post now' ? 'Post queued for publishing. It can take a few minutes to appear.' : mode === 'Schedule post' ? 'Post scheduled.' : 'Review links created. This post stays paused until the approval rule passes.', { exact: true })).toBeVisible();
});

test('Activity pagination retains microsecond cursor and de-duplicates repeated rows', async ({ page }) => {
  const cursor = { created_at: '2026-10-16T12:34:56.123456+00:00', source: 'publish', id: '00000000-0000-4000-8000-000000000071' };
  let pageNumber = 0;
  const row = { source: 'publish', id: cursor.id, action: 'smartlink.saved', actor_email: 'synthetic@example.invalid', created_at: cursor.created_at };
  const fixture = await installPublishFixtures(page, { routes: ({ url, json }) => url.pathname === '/api/v1/social/activity' ? json(++pageNumber === 1 ? { events: [row], next_cursor: cursor } : { events: [row, { ...row, id: 'two', actor_email: 'second@example.invalid' }], next_cursor: null }) : false });
  await fixture.open('/app/publish/activity'); await page.getByRole('button', { name: 'Load older activity', exact: true }).click();
  await expect(page.getByText('Showing all 2 recorded events.', { exact: true })).toBeVisible();
  expect(decodeActivityCursor(new URLSearchParams(fixture.requests.filter(row => row.path.endsWith('/activity'))[1].query).get('cursor'))).toEqual(cursor);
});
