import { test, expect, installProductFixtures, SYNTHETIC_USER, SECOND_SYNTHETIC_USER, WORKSPACE, PROJECT } from './fixtures/authenticated-product.mjs';
import { emptySequence, addSequenceText } from '../app/veyrnox/_lib/editorSequence.mjs';

const emptyProjectDocument = project_id => ({ schema_version: 1, project_id, brief: '', canvas: { aspect_ratio: '16:9', frame_rate: 30 } });
const productWrites = fixture => fixture.requests.filter(row => !['GET', 'HEAD', 'OPTIONS'].includes(row.method)
  && !(row.path === '/api/auth/session' && row.method === 'POST' && row.body?.action === 'refresh'));

async function projectFixture(page, initial = {}) {
  const state = { projects: [{ id: PROJECT, workspace_id: WORKSPACE, name: 'Synthetic project', version: 1, created_at: '2026-01-01T00:00:00Z' }], document: emptyProjectDocument(PROJECT), revision: 0, versions: [], ...initial };
  return installProductFixtures(page, { state, routes: ({ url, method, body, json, state }) => {
    const path = url.pathname;
    if (path === '/api/v1/projects' && method === 'GET') return json({ projects: state.user.id === SYNTHETIC_USER.id ? state.projects : [{ id: PROJECT, name: 'Second account project', version: 1, created_at: '2026-01-01T00:00:00Z' }] });
    if (path === '/api/v1/projects' && method === 'POST') { const project = { id: PROJECT, workspace_id: WORKSPACE, name: body.name, version: 1, created_at: '2026-01-01T00:00:00Z' }; state.projects = [project]; return json({ project }); }
    if (path === `/api/v1/projects/${PROJECT}`) {
      if (method === 'GET') return json({ project: state.projects[0] });
      const project = { ...state.projects[0], ...(body.name ? { name: body.name } : {}), version: state.projects[0].version + 1 };
      state.projects = method === 'DELETE' ? [] : [project]; return json({ project });
    }
    if (path === `/api/v1/projects/${PROJECT}/document`) {
      if (method === 'GET') {
        const version = url.searchParams.get('revision');
        return json(version ? { document: { ...state.document, brief: `Synthetic saved version ${version}` }, revision: Number(version), created_at: '2026-01-01T00:00:00Z' } : { document: state.document, revision: state.revision, created_at: '2026-01-01T00:00:00Z' });
      }
      if (state.saveFailures > 0) { state.saveFailures--; return json({ error: 'synthetic_save_unavailable' }, 503); }
      if (state.conflictOnce) { state.conflictOnce = false; state.document = { ...state.document, brief: 'Synthetic collaborator brief' }; state.revision++; return json({ error: 'VERSION_CONFLICT' }, 409); }
      if (body.expected_revision !== state.revision) return json({ error: 'VERSION_CONFLICT' }, 409);
      state.document = body.restore_revision ? { ...state.document, brief: `Synthetic saved version ${body.restore_revision}` } : body.document;
      state.revision++; state.versions = [{ revision: state.revision, created_at: '2026-01-01T00:00:00Z', restored_from: body.restore_revision || null }, ...state.versions];
      return json({ document: state.document, revision: state.revision, created_at: '2026-01-01T00:00:00Z' });
    }
    if (path === `/api/v1/projects/${PROJECT}/history`) {
      const before = Number(url.searchParams.get('before'));
      const versions = before ? state.versions.filter(row => row.revision < before) : state.versions;
      return json({ versions: versions.slice(0, 1), next_before: versions.length > 1 ? versions[0].revision : null });
    }
    return false;
  } });
}

test('Projects create/search/rename/delete mutate only the synthetic workspace and require confirmation', async ({ page }) => {
  const fixture = await projectFixture(page, { projects: [] }); await fixture.open('/app/projects');
  await page.getByRole('button', { name: 'New project', exact: true }).click(); await page.getByRole('dialog').getByRole('textbox').fill('Synthetic first project');
  await page.getByRole('button', { name: 'Create project', exact: true }).click(); await expect(page.getByRole('link', { name: 'Synthetic first project', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rename Synthetic first project', exact: true }).click(); await page.getByRole('dialog').getByRole('textbox').fill('Synthetic renamed'); await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('link', { name: 'Synthetic renamed', exact: true })).toBeVisible();
  await page.getByPlaceholder('Search by name').fill('no matching name'); await expect(page.getByText(/No projects match/)).toBeVisible(); await page.getByPlaceholder('Search by name').fill('');
  await page.getByRole('button', { name: 'Delete Synthetic renamed', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('Generated media in your library stays there');
  await page.getByRole('button', { name: 'Delete project', exact: true }).click(); await expect(page.getByText('Start with a project', { exact: true })).toBeVisible();
});

test('Project failed save preserves the draft and retry reuses the uncertain idempotency key', async ({ page }) => {
  const fixture = await projectFixture(page, { saveFailures: 1 }); await fixture.open(`/app/projects/${PROJECT}`);
  await page.getByRole('textbox', { name: 'What are you creating?', exact: true }).fill('Synthetic draft survives'); await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await expect(page.getByText(/Could not save your changes/)).toBeVisible(); await expect(page.getByRole('textbox', { name: 'What are you creating?', exact: true })).toHaveValue('Synthetic draft survives');
  await page.getByRole('button', { name: 'Retry save', exact: true }).click(); await expect(page.getByText('Saved · version 1', { exact: true })).toBeVisible();
  const writes = fixture.requests.filter(row => row.method === 'PUT' && row.path.endsWith('/document'));
  expect(writes.map(row => row.body.document.brief)).toEqual(['Synthetic draft survives', 'Synthetic draft survives']);
  expect(writes[0].idempotencyKey).toMatch(/^[A-Za-z0-9._-]{8,128}$/); expect(writes[1].idempotencyKey).toBe(writes[0].idempotencyKey);
});

test('Project conflict review preserves the draft and restore appends a version instead of overwriting history', async ({ page }) => {
  const fixture = await projectFixture(page, { conflictOnce: true, revision: 1, versions: [{ revision: 1, created_at: '2026-01-01T00:00:00Z' }] }); await fixture.open(`/app/projects/${PROJECT}`);
  await page.getByRole('textbox', { name: 'What are you creating?', exact: true }).fill('Synthetic local draft'); await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await page.getByRole('button', { name: 'Review latest version', exact: true }).click(); await expect(page.getByText('Synthetic collaborator brief', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'What are you creating?', exact: true })).toHaveValue('Synthetic local draft'); await page.getByRole('button', { name: 'Save my draft instead', exact: true }).click();
  await expect(page.getByText('Saved · version 3', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Older versions', exact: true }).click();
  await page.getByRole('button', { name: /^Version 1/ }).click(); await page.getByRole('button', { name: 'Restore as new version', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What are you creating?', exact: true })).toHaveValue('Synthetic saved version 1'); expect(fixture.state.revision).toBe(4);
});

test('Account switch remounts Projects and removes the preceding account list', async ({ page }) => {
  const fixture = await projectFixture(page); await fixture.open('/app/projects'); await expect(page.getByRole('link', { name: 'Synthetic project', exact: true })).toBeVisible();
  await fixture.switchUser(SECOND_SYNTHETIC_USER); await expect(page.getByRole('link', { name: 'Second account project', exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: 'Synthetic project', exact: true })).toHaveCount(0);
});

async function editor(page, options = {}) {
  const fixture = await installProductFixtures(page, options); const response = await fixture.open('/app/editor');
  expect(response.status(), 'The owned local server must enable the editor rollout for these fixtures').toBe(200);
  await expect(page.getByRole('region', { name: 'Multitrack editing workspace', exact: true })).toBeVisible();
  if (page.viewportSize().width < 640) await expect.poll(async () => {
    const nav = await page.getByRole('navigation', { name: 'Mobile editor sections', exact: true }).boundingBox();
    const mascot = await page.getByTestId('assistant-mascot').boundingBox();
    return Boolean(nav && mascot && mascot.y + mascot.height < nav.y);
  }, { message: 'The visible assistant must leave the mobile editor controls reachable' }).toBe(true);
  const recover = page.getByRole('button', { name: 'Discard', exact: true }); if (await recover.isVisible()) await recover.click();
  return fixture;
}
async function filesPanel(page) {
  const workspace = page.getByRole('region', { name: 'Multitrack editing workspace', exact: true });
  const panel = workspace.getByRole('region', { name: 'Local project files', exact: true });
  if (!await panel.isVisible()) await workspace.locator('summary').filter({ hasText: 'Project files' }).click();
  await expect.poll(async () => {
    const box = await panel.boundingBox();
    return Boolean(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1);
  }, { message: 'The project file controls must fit within the viewport' }).toBe(true);
  return panel;
}

test('Editor local project file refuses invalid JSON then opens a valid reversible text edit', async ({ page }) => {
  await editor(page); const panel = await filesPanel(page);
  await panel.getByLabel('Choose project JSON file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') }); await expect(panel.getByRole('alert')).toContainText('not valid JSON');
  const file = { name: 'synthetic.veyrnox.json', json: JSON.stringify({ ...emptyProjectDocument(PROJECT), schema_version: 3, timeline: addSequenceText(emptySequence(), { text: 'Synthetic title' }) }) };
  await panel.getByLabel('Choose project JSON file').setInputFiles({ name: file.name, mimeType: 'application/json', buffer: Buffer.from(file.json) });
  await expect(page.getByText(/Project file opened/)).toBeVisible(); await page.getByRole('region', { name: 'Multitrack editing workspace', exact: true }).locator('summary').filter({ hasText: 'Project files' }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); const output = await filesPanel(page); const downloading = page.waitForEvent('download'); await output.getByRole('button', { name: 'Download project file', exact: true }).click(); const download = await downloading; expect(download.suggestedFilename()).toMatch(/\.veyrnox\.json$/); await download.cancel();
});

test('Editor adds text, edits words and exposes local export settings without a cloud render', async ({ page }) => {
  const fixture = await editor(page); const sections = page.getByRole('navigation', { name: 'Mobile editor sections' }); if (await sections.isVisible()) await sections.getByRole('button', { name: 'Media', exact: true }).click();
  await page.getByRole('button', { name: 'Add text', exact: true }).click(); if (await sections.isVisible()) await sections.getByRole('button', { name: 'Adjust', exact: true }).click();
  await page.getByLabel('Words', { exact: true }).fill('Synthetic editable title'); await page.getByLabel('Words', { exact: true }).press('Tab'); await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Export', exact: true }).click(); await expect(page.getByLabel('Export format', { exact: true })).toHaveValue('mp4'); await page.getByLabel('Export format', { exact: true }).selectOption('mov'); await expect(page.getByRole('button', { name: 'Export MOV', exact: true })).toBeVisible();
  expect(productWrites(fixture)).toEqual([]);
});

test('Editor device draft is recovered after reload and sign-out removes the private edit', async ({ page }) => {
  const fixture = await editor(page); const sections = page.getByRole('navigation', { name: 'Mobile editor sections' }); if (await sections.isVisible()) await sections.getByRole('button', { name: 'Media', exact: true }).click();
  await page.getByRole('button', { name: 'Add text', exact: true }).click(); if (await sections.isVisible()) await sections.getByRole('button', { name: 'Adjust', exact: true }).click(); await page.getByLabel('Words', { exact: true }).fill('Synthetic recovered title'); await page.getByLabel('Words', { exact: true }).press('Tab');
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('veyrnox-editor-draft-v1:') && localStorage.getItem(key).includes('Synthetic recovered title')))).toBe(true);
  await fixture.open('/app/editor'); await page.getByRole('button', { name: 'Recover', exact: true }).click();
  const timeline = page.getByRole('button', { name: 'Timeline', exact: true }); if (await timeline.isVisible()) await timeline.click();
  await expect(page.getByRole('button', { name: /^Synthetic recovered title,/ })).toBeVisible();
  await fixture.switchUser(null); await expect(page.getByRole('button', { name: /^Synthetic recovered title,/ })).toHaveCount(0);
});

test('Editor Library refuses a failed read then imports a synthetic source after an explicit retry', async ({ page }) => {
  const job = '00000000-0000-4000-8000-000000000034'; let unavailable = true;
  const fixture = await editor(page, { routes: async ({ route, url, method, json }) => {
    if (url.pathname === '/api/v1/jobs' && method === 'GET') return unavailable ? json({ error: 'synthetic_library_unavailable' }, 503) : json({ jobs: [{ job_id: job, model_id: 'flux-2-pro', label: 'Synthetic Library image', has_asset: true }], next: null });
    if (url.pathname === `/api/v1/jobs/${job}/asset` && method === 'GET') return json({ mime_type: 'image/png', url: 'https://fb18d9f7052afbea5a5e0eae69948af2.r2.cloudflarestorage.com/synthetic-qa-never-forward/editor-source.png' });
    if (url.href === 'https://fb18d9f7052afbea5a5e0eae69948af2.r2.cloudflarestorage.com/synthetic-qa-never-forward/editor-source.png' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }); return true;
    }
    return false;
  } });
  const sections = page.getByRole('navigation', { name: 'Mobile editor sections' }); if (await sections.isVisible()) await sections.getByRole('button', { name: 'Media', exact: true }).click();
  await page.getByRole('button', { name: 'Add from my Library', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'Could not load the Library' })).toBeVisible();
  unavailable = false; await page.getByRole('button', { name: 'Add from my Library', exact: true }).click();
  await page.getByRole('region', { name: 'My Library', exact: true }).getByRole('button', { name: 'image: Synthetic Library image · Generated', exact: true }).click();
  await expect(page.getByTestId(`media-j-${job}`)).toContainText('Loaded');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  expect(productWrites(fixture)).toEqual([]);
});

test('Editor microphone denial is recoverable without ever acquiring a real device', async ({ page }) => {
  await page.context().addInitScript(() => {
    window.syntheticMicrophoneAttempts = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { window.syntheticMicrophoneAttempts++; throw new DOMException('Synthetic permission denied', 'NotAllowedError'); } } });
  });
  const fixture = await editor(page); const sections = page.getByRole('navigation', { name: 'Mobile editor sections' }); if (await sections.isVisible()) await sections.getByRole('button', { name: 'Media', exact: true }).click();
  await page.getByRole('navigation', { name: 'Editor tools', exact: true }).getByRole('button', { name: 'Audio', exact: true }).click();
  const recorder = page.getByRole('region', { name: 'Record voiceover', exact: true });
  await recorder.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Microphone access was blocked' })).toBeVisible(); await expect(recorder.getByRole('button', { name: 'Start recording', exact: true })).toBeEnabled();
  await recorder.getByRole('button', { name: 'Start recording', exact: true }).click(); await expect.poll(() => page.evaluate(() => window.syntheticMicrophoneAttempts)).toBe(2);
  await expect(recorder.getByRole('status')).toHaveText('Ready');
  expect(productWrites(fixture)).toEqual([]);
});
