import { test, expect, installProductFixtures, SYNTHETIC_USER, SYNTHETIC_MODELS } from './fixtures/authenticated-product.mjs';
import { capabilityFor, publicCapabilities, lengthsFor } from '../lib/modelCapabilities.js';
import { emptyFilm, STYLE_BOARDS, assetKey, testMatrix, lockAsset, buildShotPrompt, nextPromptVersion } from '../app/veyrnox/_lib/filmStudio.js';
import { filmFixture } from '../tests/fixtures/filmStudio.mjs';

const filmKey = `veyrnox_film_studio_v1:${SYNTHETIC_USER.id}`;
async function installFilm(page, film) {
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: filmKey, value: JSON.stringify(film) });
  await page.reload();
}
function readyFilm(aspect) {
  let film = { ...emptyFilm(), ...filmFixture(), stack: { image: 'flux-2-pro', imageAccess: 'Studio', video: 'seedance-2.0-fast', videoAccess: 'Studio', seconds: '10', aspect } };
  film.boards = [{ id: 'room', name: '@room:v1', type: 'location', decision: 'approved', references: Array.from({ length: 8 }, (_, i) => ({ source: `synthetic-room-${i}.png`, caption: `Synthetic view ${i}`, kind: 'reference' })) }, ...STYLE_BOARDS.map(name => ({ id: name, name, type: 'style', decision: 'approved', references: [{ source: `${name}.png`, caption: name, kind: 'reference' }] }))];
  const asset = { tag: '@room', version: 1, type: 'location', descriptor: 'An empty cream room with an oak floor and west window.', references: ['synthetic-room.png'], tests: {}, lock: null };
  asset.tests = Object.fromEntries(testMatrix(film, asset).map(row => [row.id, { result: `${row.id}.png`, verdict: 'pass' }]));
  film.assets = [asset]; film = lockAsset(film, assetKey(asset));
  const details = Object.fromEntries(['map', 'camera', 'timing', 'physics', 'lighting', 'audio', 'palette', 'quality', 'constraints'].map(key => [key, `Synthetic ${key}.`]));
  return { ...film, prompts: [nextPromptVersion(film, film.shots[0], buildShotPrompt(film, film.shots[0], details))] };
}

test('Film Setup normalizes declared duration/aspect and persists the chosen workflow', async ({ page }) => {
  const fixture = await installProductFixtures(page); await fixture.open('/app/film-studio');
  await installFilm(page, { ...emptyFilm(), name: 'Synthetic setup', stack: { image: 'flux-2-pro', imageAccess: 'Studio', video: 'External', videoAccess: 'External', seconds: '12', aspect: '1:1' } });
  await page.getByRole('navigation', { name: 'Film Studio stages' }).getByRole('button').filter({ hasText: 'Set up your tools' }).click();
  await page.getByTestId('film-video-workflow').selectOption('Studio');
  await page.getByTestId('film-video-model').selectOption('seedance-2.0-fast');
  await expect(page.getByTestId('film-clip-length')).toHaveValue('10');
  await expect(page.getByTestId('film-frame-format')).toHaveValue('16:9');
  await fixture.open('/app/film-studio');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).stack.seconds, filmKey)).toBe('10');
});

test('Film Studio hides technical file formats behind one project download', async ({ page }) => {
  const fixture = await installProductFixtures(page); await fixture.open('/app/film-studio');
  await installFilm(page, { ...emptyFilm(), name: 'Synthetic project' });
  await expect(page.locator('body')).not.toContainText('JSON');
  await expect(page.getByTestId('film-download-project')).toHaveText('Download project');
  const downloading = page.waitForEvent('download'); await page.getByTestId('film-download-project').click();
  const download = await downloading; expect(download.suggestedFilename()).toBe('Synthetic-project.zip'); await download.cancel();
});

test('Film handoff honestly blocks incompatible format then transfers a compatible complete prompt without generating', async ({ page }) => {
  const fixture = await installProductFixtures(page); await fixture.open('/app/film-studio');
  await installFilm(page, readyFilm('1:1'));
  await expect(page.getByText(/does not support the shot’s frame format/)).toBeVisible();
  await expect(page.getByTestId('film-open-in-studio')).toHaveCount(0);
  const compatible = readyFilm('9:16'); await installFilm(page, compatible);
  await page.getByTestId('film-open-in-studio').click();
  await expect(page).toHaveURL(/\/app\/create\?model=seedance-2.0-fast/);
  await expect(page.locator('[data-assistant-target="create.prompt"]')).toHaveValue(compatible.prompts[0].content);
  expect(fixture.requests.filter(row => row.path === '/api/v1/generations')).toEqual([]);
});

test('Video Agent waits for balance and its retry performs only a balance read', async ({ page }) => {
  let unavailable = true;
  const fixture = await installProductFixtures(page, { routes: ({ url, method, json }) => {
    if (url.pathname === '/api/v1/balance') return unavailable ? json({ error: 'synthetic_unavailable' }, 503) : json({ balance: 200 });
    if (url.pathname === '/api/v1/montage/plan' && method === 'POST') return json({ plan_id: 'synthetic-plan', idempotency_key: 'synthetic-plan-key', credits: 165, expires_at: Math.floor(Date.now() / 1000) + 600, plan: { summary: 'A synthetic shot', seconds: 10 } });
    return false;
  } });
  await fixture.open('/app/video-agent'); await page.getByTestId('agent-brief').fill('Synthetic lighthouse');
  await page.getByTestId('agent-plan').click();
  await expect(page.getByTestId('agent-approve')).toBeDisabled();
  await expect(page.getByTestId('agent-balance-status')).toBeVisible(); unavailable = false;
  await page.getByTestId('agent-retry-balance').click();
  await expect(page.getByTestId('agent-approve')).toBeEnabled();
  expect(fixture.requests.filter(row => row.path === '/api/v1/generations')).toEqual([]);
});

test('Video Agent expired plan cannot dispatch and editing the brief discards it', async ({ page }) => {
  const fixture = await installProductFixtures(page, { routes: ({ url, json }) => url.pathname === '/api/v1/montage/plan'
    ? json({ plan_id: 'expired-synthetic', idempotency_key: 'expired-synthetic-key', credits: 165, expires_at: 1, plan: { summary: 'Expired synthetic plan' } }) : false });
  await fixture.open('/app/video-agent'); await page.getByTestId('agent-brief').fill('Synthetic brief');
  await page.getByTestId('agent-plan').click();
  await expect(page.getByTestId('agent-approve')).toBeDisabled();
  await page.getByTestId('agent-brief').fill('Changed synthetic brief');
  await expect(page.getByTestId('agent-approve')).toHaveCount(0);
});

test('Video Agent returning focus refreshes the balance without submitting and blocks a now-unaffordable plan', async ({ page }) => {
  let balance = 800, hold = false, reads = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  const fixture = await installProductFixtures(page, { routes: async ({ url, method, json }) => {
    if (url.pathname === '/api/v1/balance' && method === 'GET') { reads++; if (hold) await pending; return json({ balance }); }
    if (url.pathname === '/api/v1/montage/plan' && method === 'POST') return json({ plan_id: 'synthetic-focus-plan', idempotency_key: 'synthetic-focus-plan-key', credits: 165, expires_at: Math.floor(Date.now() / 1000) + 600, plan: { summary: 'Synthetic focus balance test', seconds: 10 } });
    return false;
  } });
  try {
    await fixture.open('/app/video-agent');
    await page.getByTestId('agent-brief').fill('Synthetic focus balance brief');
    await page.getByTestId('agent-plan').click();
    const approve = page.getByTestId('agent-approve');
    await expect(approve).toBeEnabled();
    const before = reads;
    hold = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect(approve).toBeDisabled();
    await expect(page.getByTestId('agent-balance-status')).toBeVisible();
    balance = 100; hold = false; release();
    await expect(page.getByTestId('agent-balance')).toBeVisible();
    await expect(page.getByTestId('agent-balance')).toHaveText('165 cr · balance 100 cr');
    await expect(page.getByTestId('agent-shortfall')).toBeVisible();
    await expect(page.getByTestId('agent-shortfall')).toHaveText('You need 65 more Credits to approve this plan.');
    await expect(approve).toBeDisabled();
    expect(fixture.requests.filter(row => row.path === '/api/v1/generations')).toEqual([]);
  } finally { release(); }
});

test('Create multi-image batch preserves per-job idempotency and stops after an uncertain second submission', async ({ page }) => {
  let count = 0;
  const fixture = await installProductFixtures(page, { routes: ({ url, method, json }) => {
    if (url.pathname === '/api/v1/generations' && method === 'POST') return ++count === 1
      ? json({ job_id: '00000000-0000-4000-8000-000000000031', balance_after: 998 }) : json({ error: 'outcome_unknown' }, 503);
    if (url.pathname === '/api/v1/jobs/00000000-0000-4000-8000-000000000031') return json({ state: 'running' });
    return false;
  } });
  await fixture.open('/app/create?model=flux-2-pro'); await page.locator('[data-assistant-target="create.prompt"]').fill('Synthetic batch');
  await page.getByRole('group', { name: 'IMAGES', exact: true }).getByRole('button', { name: '4', exact: true }).click();
  await page.locator('[data-assistant-target="create.generate"]').click();
  await expect.poll(() => fixture.requests.filter(row => row.path === '/api/v1/generations').length).toBe(2);
  const calls = fixture.requests.filter(row => row.path === '/api/v1/generations'); expect(new Set(calls.map(row => row.body.idempotency_key)).size).toBe(2);
  await expect(page.getByText(/may have started and been charged/)).toBeVisible();
});

test('Create keeps the submitted image label and frame while its next draft switches to audio', async ({ page }) => {
  const job = '00000000-0000-4000-8000-000000000032';
  // FLUX's registry entry is fixed landscape; Nano Banana declares both tested formats.
  const record = capabilityFor('fal-ai/nano-banana');
  const portraitModel = { id: 'nano-banana', name: 'Synthetic nano-banana', modality: 'text-to-image', credits: 2, gated: false, durations: lengthsFor(record), capabilities: publicCapabilities(record) };
  const fixture = await installProductFixtures(page, { models: [portraitModel, ...SYNTHETIC_MODELS], routes: ({ url, method, json }) => {
    if (url.pathname === '/api/v1/generations' && method === 'POST') return json({ job_id: job, balance_after: 998 });
    if (url.pathname === `/api/v1/jobs/${job}`) return json({ state: 'running' });
    return false;
  } });
  await fixture.open('/app/create?model=nano-banana');
  await page.locator('[data-assistant-target="create.prompt"]').fill('Synthetic portrait-format still life');
  await page.getByRole('group', { name: 'ASPECT', exact: true }).getByRole('button', { name: '9:16', exact: true }).click();
  await page.locator('[data-assistant-target="create.generate"]').click();
  const result = page.locator('[data-assistant-target="create.result"]');
  await expect(result).toContainText(/RUNNING · SYNTHETIC NANO-BANANA/);
  await page.getByRole('group', { name: 'ASPECT', exact: true }).getByRole('button', { name: '16:9', exact: true }).click();
  await page.getByTestId('create-goal-audio').click();
  await expect(page.locator('[data-assistant-target="create.models"]')).toHaveAttribute('data-selected-kind', 'audio');
  await expect(result).toContainText(/RUNNING · SYNTHETIC NANO-BANANA/);
  await expect(result.locator('[style*="aspect-ratio"]')).toHaveCSS('aspect-ratio', '9 / 16');
  const calls = fixture.requests.filter(row => row.path === '/api/v1/generations');
  expect(calls).toHaveLength(1);
  expect(calls[0].body.model_id).toBe(portraitModel.id);
  expect(calls[0].body.inputs.aspect_ratio).toBe('9:16');
});

test('Create completion cannot turn the no-charge New generation action into a second paid request', async ({ page }) => {
  const job = '00000000-0000-4000-8000-000000000033';
  let settled = false;
  const fixture = await installProductFixtures(page, { routes: async ({ route, url, method, json, origin }) => {
    if (url.pathname === '/api/v1/generations' && method === 'POST') return json({ job_id: job, balance_after: 998 });
    if (url.pathname === `/api/v1/jobs/${job}`) return json({ state: settled ? 'succeeded' : 'running' });
    if (url.pathname === `/api/v1/jobs/${job}/asset`) return json({ url: `${origin}/synthetic-create-image.svg`, mime_type: 'image/svg+xml' });
    if (url.pathname === '/synthetic-create-image.svg') {
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><rect width="16" height="9" fill="blue"/></svg>' });
      return true;
    }
    return false;
  } });
  await fixture.open('/app/create?model=flux-2-pro');
  await page.locator('[data-assistant-target="create.prompt"]').fill('Synthetic reset-race image');
  await page.locator('[data-assistant-target="create.generate"]').click();
  const reset = page.locator('[data-assistant-target="create.generate"]');
  await expect(reset).toBeVisible();
  await expect(reset).toHaveAttribute('aria-label', 'New generation — no charge');
  await page.getByTestId('create-goal-audio').click();
  settled = true;
  await expect(page.locator('[data-assistant-target="create.result"]').getByTestId('generated-result-image')).toBeVisible();
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(page.locator('[data-assistant-target="create.generate"]')).toBeVisible();
  expect(fixture.requests.filter(row => row.path === '/api/v1/generations')).toHaveLength(1);
});

test('Create with unavailable live catalog remains non-billable and retains its prompt', async ({ page }) => {
  const fixture = await installProductFixtures(page, { routes: ({ url, json }) => url.pathname === '/api/catalog' ? json({ error: 'synthetic_catalog_unavailable' }, 503) : false });
  await fixture.open('/app/create'); await page.locator('[data-assistant-target="create.prompt"]').fill('Keep my synthetic prompt');
  await expect(page.locator('[data-assistant-target="create.generate"]')).toBeDisabled();
  await expect(page.locator('[data-assistant-target="create.prompt"]')).toHaveValue('Keep my synthetic prompt');
  expect(fixture.requests.filter(row => row.path === '/api/v1/generations')).toEqual([]);
});

test('AI music validates declared duration before a synthetic refusal and preserves the musical brief', async ({ page }) => {
  const fixture = await installProductFixtures(page, { routes: ({ url, method, json }) =>
    url.pathname === '/api/v1/generations' && method === 'POST' ? json({ error: 'inputs_invalid:prompt' }, 422) : false });
  const response = await fixture.open('/app/create?model=ace-step');
  expect(response.status()).toBe(200);
  const prompt = page.locator('[data-assistant-target="create.prompt"]');
  const generate = page.locator('[data-assistant-target="create.generate"]');
  await expect(prompt).toHaveValue(''); await expect(generate).toBeDisabled();
  await prompt.fill('Synthetic instrumental piano, no vocals');
  const duration = page.getByRole('spinbutton', { name: 'Audio duration in seconds', exact: true });
  await expect(duration).toHaveValue('60'); await duration.fill('61');
  await expect(generate).toBeDisabled(); await expect(page.getByText('Use a whole number from 5 to 60.', { exact: true })).toBeVisible();
  expect(fixture.requests.filter(row => row.path === '/api/v1/generations')).toEqual([]);
  await duration.fill('12'); await generate.click();
  await expect(page.getByRole('alert').filter({ hasText: 'The prompt is empty or too long' })).toBeVisible();
  await expect(prompt).toHaveValue('Synthetic instrumental piano, no vocals');
  const calls = fixture.requests.filter(row => row.path === '/api/v1/generations');
  expect(calls).toHaveLength(1); expect(calls[0].body.model_id).toBe('ace-step');
  expect(calls[0].body.inputs).toEqual({ prompt: 'Synthetic instrumental piano, no vocals', duration: 12 });
});

test('AI speech requires user words and retains them after a synthetic uncertain submission without retrying', async ({ page }) => {
  const fixture = await installProductFixtures(page, { routes: ({ url, method, json }) =>
    url.pathname === '/api/v1/generations' && method === 'POST' ? json({ error: 'outcome_unknown' }, 503) : false });
  const response = await fixture.open('/app/create?model=elevenlabs-tts-turbo');
  expect(response.status()).toBe(200);
  const prompt = page.locator('[data-assistant-target="create.prompt"]');
  const generate = page.locator('[data-assistant-target="create.generate"]');
  await expect(prompt).toHaveAttribute('placeholder', 'Type the words to say…');
  await expect(prompt).toHaveValue(''); await expect(generate).toBeDisabled();
  await prompt.fill('   '); await expect(generate).toBeDisabled();
  await prompt.fill('This is a synthetic speech QA request.'); await generate.click();
  await expect(page.getByRole('alert').filter({ hasText: 'may have started and been charged' })).toBeVisible();
  await expect(prompt).toHaveValue('This is a synthetic speech QA request.');
  const calls = fixture.requests.filter(row => row.path === '/api/v1/generations');
  expect(calls).toHaveLength(1); expect(calls[0].body.model_id).toBe('elevenlabs-tts-turbo');
  expect(calls[0].body.inputs).toEqual({ prompt: 'This is a synthetic speech QA request.' });
  expect(calls[0].body.idempotency_key).toMatch(/^[A-Za-z0-9._-]{8,128}$/);
});

test('Chat folder create, rename and delete retain conversations without invoking a model', async ({ page }) => {
  let folders = [];
  const fixture = await installProductFixtures(page, { routes: ({ url, method, body, json }) => {
    if (url.pathname === '/api/v1/chat/folders' && method === 'GET') return json({ folders });
    if (url.pathname === '/api/v1/chat/folders' && method === 'POST') { const folder = { id: '00000000-0000-4000-8000-000000000041', name: body.name }; folders = [folder]; return json({ folder }); }
    if (url.pathname.endsWith('/00000000-0000-4000-8000-000000000041') && method === 'PATCH') { folders = folders.map(folder => ({ ...folder, name: body.name })); return json({ folder: folders[0] }); }
    if (url.pathname.endsWith('/00000000-0000-4000-8000-000000000041') && method === 'DELETE') { folders = []; return json({ ok: true }); }
    return false;
  } });
  await fixture.open('/app/chat');
  if (page.viewportSize().width < 768) await page.getByTestId('chat-open-drawer').click();
  const chats = page.getByRole('navigation', { name: 'Chats', exact: true });
  await chats.getByRole('button', { name: 'New folder', exact: true }).click(); await chats.getByLabel('New folder name', { exact: true }).fill('Synthetic folder'); await chats.getByLabel('New folder name', { exact: true }).press('Enter');
  await chats.getByLabel('Folder', { exact: true }).selectOption('00000000-0000-4000-8000-000000000041');
  await chats.getByRole('button', { name: 'Rename folder Synthetic folder', exact: true }).click(); await chats.getByLabel('Folder name', { exact: true }).fill('Renamed synthetic'); await chats.getByLabel('Folder name', { exact: true }).press('Enter');
  await chats.getByRole('button', { name: 'Delete folder Renamed synthetic', exact: true }).click(); await chats.getByRole('alert').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(chats.getByLabel('Folder', { exact: true }).getByRole('option', { name: /Renamed synthetic/ })).toHaveCount(0);
});
