import { test, expect, installProductFixtures, PROJECT, SYNTHETIC_USER } from './fixtures/authenticated-product.mjs';
import { installPublishFixtures, BRAND } from './fixtures/authenticated-publish.mjs';
import { emptySequence, addSequenceText } from '../app/veyrnox/_lib/editorSequence.mjs';

const REVIEW_TOKEN = 'synthetic-review-link-never-a-real-credential';
const INVITE_TOKEN = 'synthetic-invite-link-never-a-real-credential';
const COMMENT = '00000000-0000-4000-8000-000000000081';
const REVIEW_PATH = `/app/editor/review?project=${PROJECT}&revision=1`;
const productWrites = fixture => fixture.requests.filter(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method)
  && !(r.path === '/api/auth/session' && r.method === 'POST' && r.body?.action === 'refresh'));

async function openReal(fixture, path) {
  const response = await fixture.open(path);
  expect(response.status(), `The actual first-party document ${path} must exist`).toBe(200);
}

test('Saved Editor review loads a valid revision and recovers comment reads without editing its document', async ({ page }) => {
  let reviewReadsFail = true, comments = [];
  const document = { schema_version: 3, project_id: PROJECT, brief: 'Synthetic saved review', canvas: { aspect_ratio: '16:9', frame_rate: 30 }, timeline: addSequenceText(emptySequence(), { text: 'Synthetic saved review' }) };
  const fixture = await installProductFixtures(page, { routes: ({ url, origin, method, body, json }) => {
    if (url.origin !== origin) return false;
    if (url.pathname === `/api/v1/projects/${PROJECT}/document` && method === 'GET' && url.searchParams.get('revision') === '1') return json({ document, revision: 1 });
    if (url.pathname !== `/api/v1/projects/${PROJECT}/review` || url.searchParams.get('revision') !== '1') return false;
    if (method === 'GET') return reviewReadsFail ? json({ error: 'synthetic_review_unavailable' }, 503) : json({ comments, canComment: true, canResolve: true, total: comments.length, nextCursor: null, truncated: false });
    if (method === 'POST') {
      comments = [...comments, { id: COMMENT, body: body.body, frame: body.frame, version: 1, resolved: false, created_at: '2026-10-16T12:00:00Z' }];
      return json({ comment: comments.at(-1) });
    }
    if (method === 'PATCH' && body.comment_id === COMMENT) { comments = comments.map(c => ({ ...c, resolved: body.resolved, version: c.version + 1 })); return json({ ok: true }); }
    return false;
  } });
  await openReal(fixture, REVIEW_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'Review saved version 1', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Saved edit preview', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  const review = page.getByRole('region', { name: 'Project review', exact: true });
  await expect(review.getByRole('alert')).toContainText('Could not complete this request. Your draft is kept.');
  await expect(review.getByRole('textbox', { name: 'Review comment', exact: true })).toBeDisabled();
  reviewReadsFail = false;
  await review.getByRole('button', { name: 'Refresh comments', exact: true }).click();
  await review.getByRole('textbox', { name: 'Review comment', exact: true }).fill('Synthetic version-specific comment');
  await review.getByRole('button', { name: /^Comment at / }).click();
  await expect(review.getByText('Synthetic version-specific comment', { exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Resolve comment', exact: true }).click();
  await expect(review.getByRole('button', { name: 'Reopen comment', exact: true })).toBeVisible();
  expect(fixture.requests.some(r => r.path.endsWith('/document') && r.query === '?revision=1' && r.method === 'GET')).toBe(true);
  expect(productWrites(fixture).map(r => [r.path, r.method])).toEqual([
    [`/api/v1/projects/${PROJECT}/review`, 'POST'], [`/api/v1/projects/${PROJECT}/review`, 'PATCH'],
  ]);
});

test('Saved Editor review rejects an invalid revision instead of counting a 404 as an interior', async ({ page }) => {
  const fixture = await installProductFixtures(page);
  const response = await fixture.open(`/app/editor/review?project=${PROJECT}&revision=0`);
  expect(response.status()).toBe(404);
  await expect(page.getByRole('img', { name: 'Saved edit preview', exact: true })).toHaveCount(0);
  expect(fixture.requests.some(r => r.path.startsWith('/api/v1/projects/'))).toBe(false);
});

for (const [query, copy] of [
  ['', 'This page was opened without a connection response.'],
  ['?code=synthetic-code&state=synthetic-state', 'This was opened in a different browser or tab'],
]) test(`Social callback refuses ${query ? 'a missing PKCE verifier' : 'a missing OAuth response'} without exchange`, async ({ page }) => {
  const fixture = await installProductFixtures(page);
  await openReal(fixture, `/social/connect/callback/facebook${query}`);
  await expect(page.getByText(copy, { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Veyrnox Publish', exact: true })).toHaveAttribute('href', '/app/publish');
  expect(productWrites(fixture)).toEqual([]);
});

async function callbackFixture(page, onCallback) {
  // A made-up verifier for this synthetic flow, never a copied browser secret.
  await page.context().addInitScript(() => sessionStorage.setItem('veyrnox_social_pkce_verifier_facebook', 'synthetic-only-verifier-not-a-real-oauth-secret'));
  return installPublishFixtures(page, { routes: ({ url, method, body, json }) => {
    if (url.pathname === '/api/v1/social/accounts/facebook/callback' && method === 'POST') return onCallback({ body, json });
    return false;
  } });
}

test('Social callback destination selection requires a choice and exposes an expired synthetic selection', async ({ page }) => {
  const fixture = await callbackFixture(page, ({ body, json }) => body.selectionId
    ? json({ error: 'selection_expired' }, 409)
    : json({ selectionId: 'synthetic-selection', choices: [{ id: 'synthetic-page', label: 'Synthetic QA Page' }] }));
  await openReal(fixture, '/social/connect/callback/facebook?code=synthetic-code&state=synthetic-state');
  await expect(page.getByRole('button', { name: 'Connect destination', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Destination', exact: true }).selectOption('synthetic-page');
  await page.getByRole('button', { name: 'Connect destination', exact: true }).click();
  await expect(page.getByText('This selection has expired. Start connecting again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Destination', exact: true })).toHaveCount(0);
  expect(productWrites(fixture).map(r => r.body)).toEqual([
    { code: 'synthetic-code', state: 'synthetic-state', codeVerifier: 'synthetic-only-verifier-not-a-real-oauth-secret' },
    { selectionId: 'synthetic-selection', resourceId: 'synthetic-page' },
  ]);
});

test('Social callback synthetic success returns to the real Publish UI with no provider navigation', async ({ page }) => {
  const fixture = await callbackFixture(page, ({ json }) => json({ ok: true }));
  await openReal(fixture, '/social/connect/callback/facebook?code=synthetic-code&state=synthetic-state');
  await expect(page).toHaveURL(/\/app\/publish$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Veyrnox Publish', exact: true })).toBeVisible();
  expect(productWrites(fixture).map(r => r.path)).toEqual(['/api/v1/social/accounts/facebook/callback']);
});

test('Token review preserves comment after synthetic save failure then acknowledges the retried decision', async ({ page }) => {
  let failures = 1;
  const fixture = await installProductFixtures(page, { routes: ({ url, origin, method, body, json }) => {
    if (url.origin !== origin || url.pathname !== `/api/social/approvals/${REVIEW_TOKEN}`) return false;
    if (method === 'GET') return json({ brand_name: 'Synthetic review brand', networks: ['facebook'], global_text: 'A synthetic post, never delivered.', scheduled_at: '2026-10-20T12:00:00Z', policy: 'all', decision: 'pending', request_status: 'pending' });
    if (method === 'POST') { if (failures-- > 0) return json({ error: 'synthetic_decision_unavailable' }, 503); return json({ decision: body.decision, request_status: 'approved' }); }
    return false;
  } });
  await openReal(fixture, `/social/review/${REVIEW_TOKEN}`);
  await expect(page.getByText('Synthetic review brand', { exact: true })).toBeVisible();
  const comment = page.getByRole('textbox', { name: 'Comment (optional)', exact: true });
  await comment.fill('Synthetic reviewer comment');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Your decision could not be saved.' })).toBeVisible();
  await expect(comment).toHaveValue('Synthetic reviewer comment');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Your decision: approved. Request status: approved.');
  expect(productWrites(fixture).map(r => r.body)).toEqual(Array(2).fill({ decision: 'approved', comment: 'Synthetic reviewer comment' }));
});

test('Expired token review exposes no review content or decision buttons', async ({ page }) => {
  const fixture = await installProductFixtures(page, { routes: ({ url, origin, method, json }) => url.origin === origin && url.pathname === `/api/social/approvals/${REVIEW_TOKEN}` && method === 'GET' ? json({ error: 'expired' }, 410) : false });
  await openReal(fixture, `/social/review/${REVIEW_TOKEN}`);
  await expect(page.getByRole('alert').filter({ hasText: 'This review link is invalid, expired or no longer available.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  expect(productWrites(fixture)).toEqual([]);
});

test('Team invitation handles synthetic identity refusal then accepts the same isolated invitation', async ({ page }) => {
  let failures = 1;
  const fixture = await installProductFixtures(page, { routes: ({ url, origin, method, json }) => {
    if (url.origin !== origin) return false;
    if (url.pathname === `/api/social/team/${INVITE_TOKEN}` && method === 'GET') return json({ brand_name: 'Synthetic invited brand', email: SYNTHETIC_USER.email, role: 'editor', expires_at: '2099-01-01T00:00:00Z', status: 'pending' });
    if (url.pathname === '/api/v1/social/team/accept' && method === 'POST') return failures-- > 0 ? json({ error: 'invited_email_required' }, 403) : json({ brand_id: BRAND });
    return false;
  } });
  await openReal(fixture, `/social/team/invite/${INVITE_TOKEN}`);
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: `Sign in with ${SYNTHETIC_USER.email} to accept this invitation.` })).toBeVisible();
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'You joined Synthetic invited brand', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Veyrnox Publish', exact: true })).toHaveAttribute('href', '/app/publish');
  expect(productWrites(fixture).map(r => r.body)).toEqual([{ token: INVITE_TOKEN }, { token: INVITE_TOKEN }]);
});

test('Expired team invitation cannot be accepted', async ({ page }) => {
  const fixture = await installProductFixtures(page, { routes: ({ url, origin, method, json }) => url.origin === origin && url.pathname === `/api/social/team/${INVITE_TOKEN}` && method === 'GET' ? json({ error: 'expired' }, 410) : false });
  await openReal(fixture, `/social/team/invite/${INVITE_TOKEN}`);
  await expect(page.getByRole('alert').filter({ hasText: 'This team invitation is invalid, expired or no longer available.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Accept invitation|Sign in to accept/ })).toHaveCount(0);
  expect(productWrites(fixture)).toEqual([]);
});
