import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const QUOTE_ID = 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b';
const GENERATION_ID = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
const JOB_A = 'c7ed2d0d-8276-4fbb-9c4f-39f401a3158d';
const JOB_B = 'd8ed2d0d-8276-4fbb-9c4f-39f401a3158e';
const QUOTE_ID_2 = 'e9ed2d0d-8276-4fbb-9c4f-39f401a3158f';
const GENERATION_ID_2 = 'faed2d0d-8276-4fbb-9c4f-39f401a31580';
const JOB_C = 'abed2d0d-8276-4fbb-9c4f-39f401a31581';
const JOB_D = 'bced2d0d-8276-4fbb-9c4f-39f401a31582';
const CHAT_THREAD = 'cced2d0d-8276-4fbb-9c4f-39f401a31583';
const LYRICIST_OLD = 'dded2d0d-8276-4fbb-9c4f-39f401a31584';
const LYRICIST_NEW = 'eeed2d0d-8276-4fbb-9c4f-39f401a31585';

async function installMockSession(page) {
  await page.context().addInitScript(() => {
    localStorage.setItem('veyrnox_supabase_session', JSON.stringify({
      access_token: 'mock-browser-token',
      refresh_token: null,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    }));
    localStorage.setItem(
      'veyrnox_feature_tours_v1:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      JSON.stringify([
        'create', 'chat', 'page:music/create', 'page:music/library',
        'page:music/sounds', 'page:music/workspaces', 'page:music/playlists', 'page:music/studio',
      ]),
    );
  });
}

const entitlements = () => ({
  available: true,
  mode: 'simple',
  output_count: 2,
  concurrency_limit: 4,
  balance: 23,
  free_credits: 3,
  free_expires_at: null,
  models: [{
    id: 'ace-step',
    name: 'ACE-Step',
    credits_per_candidate: 5,
    total_credits: 10,
    instrumental_only: true,
    generation_modes: ['simple'],
    controls: { description: true, seed: true, variety: false, style_influence: false, exclude_styles: false, duration_seconds: { min: 10, max: 60, default: 60 }, lyrics: false, styles: false, instrumental: 'required' },
    requires_paid_plan: false,
    available: true,
  }, {
    id: 'ace-step-1.5',
    name: 'ACE-Step 1.5',
    credits_per_candidate: 3,
    total_credits: 6,
    instrumental_only: false,
    generation_modes: ['simple', 'custom'],
    controls: { description: true, seed: false, variety: true, style_influence: true, exclude_styles: true, duration_seconds: { min: 10, max: 60, default: 60 }, lyrics: true, styles: true, instrumental: 'optional' },
    requires_paid_plan: true,
    available: true,
  }],
  custom_drafts: { available: true, autosave: true, generation_supported: true, lyrics_max: 3000, styles_max: 500, title_max: 80 },
  policy: { version: 'music-prompt-v1', pre_debit: true },
});

function wav(seconds = 2, sampleRate = 8000) {
  const samples = Math.floor(seconds * sampleRate); const out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF', 0); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24); out.writeUInt32LE(sampleRate * 2, 28); out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(samples * 2, 40);
  return out;
}

const exactQuote = ({ quoteId = QUOTE_ID, modelId = 'ace-step', unitCredits = 5 } = {}) => ({
  quote_id: quoteId,
  model_id: modelId,
  output_count: 2,
  credits_per_candidate: unitCredits,
  total_credits: unitCredits * 2,
  balance: 23,
  balance_after: 23 - unitCredits * 2,
  affordable: true,
  expires_at: new Date(Date.now() + 300_000).toISOString(),
  policy_version: 'music-prompt-v1',
});

function isExpectedDevProbe(url) {
  return url.endsWith('/reticle') || url.includes('/auth/v1/settings') || url.includes('challenges.cloudflare.com');
}

test.beforeEach(async ({ page }) => {
  const context = page.context();
  await context.route('**/api/catalog', (route) => route.fulfill({ json: { models: [] } }));
  await context.route('**/api/auth/session', (route) => {
    const body = route.request().postDataJSON();
    if (body?.action === 'refresh') return route.fulfill({ status: 401, json: { error: 'no_session' } });
    if (body?.action === 'establish' && body.refresh_token === 'phone-refresh-token') {
      return route.fulfill({ json: {
        access_token: 'phone-browser-token', expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', phone: '+447700900123' },
      } });
    }
    return route.fulfill({ json: {
      access_token: 'mock-browser-token', expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    } });
  });
  await context.route('**/api/v1/account/language', (route) => route.fulfill({ json: { ok: true } }));
  await context.route('**/api/v1/checkin', (route) => route.fulfill({ json: {
    ok: true, claimed_today: true, streak: 1, next_day: 2, next_credits: 1,
    rewards: [1, 1, 2, 2, 2, 3],
  } }));
  page.qaFailures = [];
  page.expectedRequestFailures = new Set();
  page.expectedConsoleErrorUrls = new Set();
  page.expectedConsoleErrorUrls.add('http://127.0.0.1:4402/api/auth/session');
  page.expectedConsoleText = new Set();
  page.on('console', (message) => {
    if (message.type() === 'error'
      // Response and requestfailed listeners below retain the URL and status;
      // Chrome's duplicate generic resource console line carries neither.
      && !message.text().startsWith('Failed to load resource:')
      && !page.expectedConsoleText.has(message.text())
      && !page.expectedConsoleErrorUrls.has(message.location().url)
      && !isExpectedDevProbe(message.location().url)) {
      page.qaFailures.push(`console: ${message.text()}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 500 && response.headers()['x-music-test-expected-error'] !== '1') {
      page.qaFailures.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('pageerror', (error) => page.qaFailures.push(`page error: ${error.message}`));
  page.on('requestfailed', (request) => {
    if (!isExpectedDevProbe(request.url()) && !page.expectedRequestFailures.has(request.url())) {
      page.qaFailures.push(`request failed: ${request.url()} ${request.failure()?.errorText || ''}`);
    }
  });
});

test.afterEach(async ({ page }) => {
  expect(page.qaFailures, 'no unexpected console errors, 5xx responses or failed requests').toEqual([]);
});

test('F01-H1 guest prompt survives sign-up handoff into private Create', async ({ page }) => {
  // Cloudflare rejects localhost with its production site key. The sign-up
  // handoff itself is still exercised; this exact third-party refusal is an
  // expected local-only console signal.
  page.expectedConsoleText.add('[auth] turnstile check failed: 110200');
  let generationCalls = 0;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (request.method() === 'GET' && path.endsWith('/music/sources')) return route.fulfill({ json: { sources: [] } });
    if (path.includes('/generation')) generationCalls += 1;
    return route.abort('failed');
  });
  await page.goto('/music');
  await page.getByRole('button', { name: 'Try a direction' }).click();
  await expect(page.getByRole('textbox', { name: 'What should it feel like?' })).not.toHaveValue('');
  await page.evaluate(() => {
    window.__musicAuthEvents = [];
    window.addEventListener('veyrnox:auth-required', (event) => window.__musicAuthEvents.push(event.detail));
  });
  const direction = 'A patient sunrise rhythm with muted piano and soft analog air';
  await page.getByRole('textbox', { name: 'What should it feel like?' }).fill(direction);
  await page.getByRole('button', { name: 'Continue to private creation' }).click();
  await expect.poll(() => page.evaluate(() => window.__musicAuthEvents.length)).toBe(1);
  expect(await page.evaluate(() => window.__musicAuthEvents[0])).toEqual({
    mode: 'sign_up', returnTo: '/app/music/create?from=public',
  });
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('veyrnox.music.public-draft.v1')).prompt)).toBe(direction);
  await page.evaluate(() => {
    localStorage.setItem('veyrnox_supabase_session', JSON.stringify({
      access_token: 'mock-browser-token', refresh_token: null,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    }));
  });
  await page.goto('/app/music/create?from=public');
  await expect(page.getByRole('textbox', { name: /describe the sound/i })).toHaveValue(direction);
  await expect(page.getByText(/Review an exact live-catalog quote/).first()).toBeVisible();
  expect(generationCalls).toBe(0);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F01-H2 phone onboarding requests and verifies one SMS code into the shared session', async ({ page }) => {
  const authBodies = [];
  await page.route('**/auth/v1/settings', (route) => route.fulfill({ json: {
    external: { phone: true, apple: false, google: false }, disable_signup: false, passkeys_enabled: false,
  } }));
  await page.route('**/auth/v1/otp', async (route) => {
    authBodies.push({ path: '/otp', body: route.request().postDataJSON() });
    return route.fulfill({ json: {} });
  });
  await page.route('**/auth/v1/verify', async (route) => {
    authBodies.push({ path: '/verify', body: route.request().postDataJSON() });
    return route.fulfill({ json: {
      access_token: 'phone-browser-token', refresh_token: 'phone-refresh-token', expires_in: 3600,
      user: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', phone: '+447700900123' },
    } });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?auth=sign_up');
  const storageNotice = page.getByRole('region', { name: 'Browser storage notice' });
  await storageNotice.waitFor({ state: 'visible' });
  await storageNotice.locator('[data-storage-dismiss]').click();
  await expect(storageNotice).toBeHidden();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Use phone instead' }).click();
  await expect(dialog.getByText('Continue with phone')).toBeVisible();
  await dialog.getByLabel('Mobile number').fill('+44 (7700) 900123');
  await dialog.getByRole('button', { name: 'Text me a code' }).click();
  await expect(dialog.getByText('We sent a six-digit code to +447700900123.')).toBeVisible();
  await dialog.getByLabel('Six-digit code').fill('123456');
  const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
  await dialog.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(dialog).toBeHidden();

  expect(authBodies).toEqual([
    { path: '/otp', body: { phone: '+447700900123', create_user: true } },
    { path: '/verify', body: { phone: '+447700900123', token: '123456', type: 'sms' } },
  ]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('veyrnox_supabase_session')).user.phone)).toBe('+447700900123');
});

test('F02-H2 server Simple quotes before spending and tracks two candidates', async ({ page }) => {
  const generationBodies = [];
  let polls = 0;

  await installMockSession(page);

  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) {
      return route.fulfill({ json: entitlements() });
    }
    if (request.method() === 'POST' && path.endsWith('/music/generation-quotes')) {
      expect(request.postDataJSON()).toEqual({
        mode: 'simple',
        prompt: 'Slow instrumental harbour lights',
        title: 'Harbour Frame',
        instrumental: true,
        model_id: 'ace-step',
        duration_seconds: 60,
      });
      return route.fulfill({ status: 201, json: exactQuote() });
    }
    if (request.method() === 'POST' && path.endsWith('/music/generations')) {
      generationBodies.push(request.postDataJSON());
      return route.fulfill({ status: 202, json: {
        generation_id: GENERATION_ID,
        state: 'debited',
        balance_after: 13,
        candidates: [
          { ordinal: 1, label: 'A', job_id: JOB_A, state: 'queued' },
          { ordinal: 2, label: 'B', job_id: JOB_B, state: 'queued' },
        ],
      } });
    }
    if (request.method() === 'GET' && path.endsWith(`/music/generations/${GENERATION_ID}`)) {
      polls += 1;
      const ready = polls > 1;
      return route.fulfill({ json: {
        id: GENERATION_ID,
        state: ready ? 'succeeded' : 'running',
        model_id: 'ace-step',
        title: 'Harbour Frame',
        candidates: [
          { ordinal: 1, label: 'A', job_id: JOB_A, state: ready ? 'ready' : 'running', audio_url: ready ? 'data:audio/wav;base64,UklGRg==' : null },
          { ordinal: 2, label: 'B', job_id: JOB_B, state: ready ? 'ready' : 'running', audio_url: ready ? 'data:audio/wav;base64,UklGRg==' : null },
        ],
      } });
    }
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/music/create');
  await expect(page.getByText('Private beta · authenticated creation and organization')).toBeVisible();
  await expect(page.getByText('23 cr')).toBeVisible();
  await expect(page.getByRole('option', { name: 'ACE-Step', exact: true })).toBeAttached();
  await expect(page.getByRole('tab', { name: 'Custom' })).toBeEnabled();

  const instrumental = page.getByRole('checkbox', { name: /instrumental/i });
  await instrumental.uncheck();
  await expect(page.getByText('Vocal and lyrics generation is not connected in this increment.')).toBeVisible();
  await instrumental.check();
  await page.getByRole('textbox', { name: /describe the sound/i }).fill('Slow instrumental harbour lights');
  await page.getByRole('textbox', { name: /working title/i }).fill('Harbour Frame');
  await page.getByRole('button', { name: 'Review exact quote' }).click();

  await expect(page.getByText('2 versions × 5 credits')).toBeVisible();
  await expect(page.getByText('10 credits', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'replica/suno/clone-screens/S05-server-mobile.png', fullPage: true });
  expect(generationBodies).toHaveLength(0);

  await page.getByRole('button', { name: 'Create two versions · 10 cr' }).evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(page.getByText('13 cr')).toBeVisible();
  await expect(page.getByTestId('music-candidate-a')).toHaveAttribute('data-status', 'ready', { timeout: 8_000 });
  await expect(page.getByTestId('music-candidate-b')).toHaveAttribute('data-status', 'ready', { timeout: 8_000 });

  expect(generationBodies).toHaveLength(1);
  expect(generationBodies[0].quote_id).toBe(QUOTE_ID);
  expect(generationBodies[0].idempotency_key).toMatch(/^vx-[0-9a-f-]{36}$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'replica/suno/clone-screens/S08-server.png', fullPage: true });
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F02-H3 paid model selection produces the ACE-Step 1.5 live-catalog quote', async ({ page }) => {
  await installMockSession(page);
  let quoteBody = null;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) {
      return route.fulfill({ json: entitlements() });
    }
    if (request.method() === 'POST' && path.endsWith('/music/generation-quotes')) {
      quoteBody = request.postDataJSON();
      return route.fulfill({ status: 201, json: exactQuote({ modelId: 'ace-step-1.5', unitCredits: 3 }) });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/create');
  await expect(page.locator('#main').getByTestId('music-credits')).toHaveText('23 cr');
  const modelPicker = page.getByRole('combobox', { name: /verified model/i });
  await modelPicker.selectOption('ace-step-1.5');
  await expect(modelPicker).toHaveValue('ace-step-1.5');
  await page.getByText('Advanced controls').click();
  const variety = page.getByRole('slider', { name: 'Variety' });
  await expect(variety).toHaveValue('50');
  await variety.fill('78');
  await expect(page.getByText('78%')).toBeVisible();
  await page.getByRole('slider', { name: 'Style influence' }).fill('35');
  await page.getByRole('textbox', { name: /exclude styles or instruments/i }).fill('distorted guitar, orchestral strings');
  await page.getByRole('slider', { name: 'Song duration' }).fill('45');
  await page.getByRole('textbox', { name: /describe the sound/i }).fill('Patient brass with a wide nocturnal pulse');
  await page.getByRole('button', { name: 'Review exact quote' }).click();

  expect(quoteBody).toEqual({
    mode: 'simple',
    prompt: 'Patient brass with a wide nocturnal pulse',
    title: '',
    instrumental: true,
    model_id: 'ace-step-1.5',
    variety: 78,
    style_influence: 35,
    exclude_styles: 'distorted guitar, orchestral strings',
    duration_seconds: 45,
  });
  await expect(page.getByText('2 versions × 3 credits')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create two versions · 6 cr' })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F03-H9 saved owned lyrics quote and generate through the Custom-ready paid model', async ({ page }) => {
  await installMockSession(page);
  let quoteBody = null;
  let saveBody = null;
  let polls = 0;
  const draft = {
    id: 'aaed2d0d-8276-4fbb-9c4f-39f401a31581', model_id: 'ace-step-1.5',
    lyrics: '[Verse]\nHarbour lights lean into dawn\n[Chorus]\nCarry the quiet home',
    styles: 'Warm piano, restrained percussion, 84 bpm', title: 'Harbour Rights',
    revision: 4, updated_at: new Date().toISOString(),
  };
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (request.method() === 'GET' && path.endsWith('/music/sources')) return route.fulfill({ json: { sources: [] } });
    if (request.method() === 'GET' && path.endsWith('/music/drafts/custom')) return route.fulfill({ json: { draft } });
    if (request.method() === 'PUT' && path.endsWith('/music/drafts/custom')) {
      saveBody = request.postDataJSON();
      return route.fulfill({ json: { draft: { ...draft, revision: 5 } } });
    }
    if (request.method() === 'POST' && path.endsWith('/music/generation-quotes')) {
      quoteBody = request.postDataJSON();
      return route.fulfill({ status: 201, json: { ...exactQuote({ modelId: 'ace-step-1.5', unitCredits: 3 }), mode: 'custom' } });
    }
    if (request.method() === 'POST' && path.endsWith('/music/generations')) {
      return route.fulfill({ status: 202, json: {
        generation_id: GENERATION_ID, state: 'debited', balance_after: 17,
        candidates: [{ ordinal: 1, label: 'A', job_id: JOB_A, state: 'queued' }, { ordinal: 2, label: 'B', job_id: JOB_B, state: 'queued' }],
      } });
    }
    if (request.method() === 'GET' && path.endsWith(`/music/generations/${GENERATION_ID}`)) {
      polls += 1;
      return route.fulfill({ json: {
        id: GENERATION_ID, state: polls > 1 ? 'succeeded' : 'running', model_id: 'ace-step-1.5', title: draft.title,
        candidates: [{ ordinal: 1, label: 'A', job_id: JOB_A, state: polls > 1 ? 'ready' : 'running', audio_url: 'data:audio/wav;base64,UklGRg==' }, { ordinal: 2, label: 'B', job_id: JOB_B, state: polls > 1 ? 'ready' : 'running', audio_url: 'data:audio/wav;base64,UklGRg==' }],
      } });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/create?mode=custom');
  await expect(page.getByRole('textbox', { name: /original lyrics or structure/i })).toHaveValue(draft.lyrics);
  await expect(page.getByRole('combobox', { name: /draft target/i })).toHaveValue('ace-step-1.5');
  await page.getByRole('slider', { name: 'Custom song duration' }).fill('40');
  await page.getByRole('checkbox', { name: /I wrote these lyrics/i }).check();
  await page.getByRole('button', { name: 'Review Custom quote' }).click();
  await expect(page.getByText('2 versions × 3 credits')).toBeVisible();
  expect(saveBody).toEqual({ revision: 4, model_id: 'ace-step-1.5', lyrics: draft.lyrics, styles: draft.styles, title: draft.title });
  expect(quoteBody).toEqual({ mode: 'custom', draft_revision: 5, instrumental: false, rights_confirmed: true, duration_seconds: 40 });
  await page.getByRole('button', { name: 'Create two lyric versions · 6 cr' }).click();
  await expect(page.getByTestId('music-candidate-a')).toHaveAttribute('data-status', 'ready', { timeout: 8_000 });
  await expect(page.getByTestId('music-candidate-b')).toHaveAttribute('data-status', 'ready', { timeout: 8_000 });
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F03-H10 Custom instrumental freezes the mode and never requires lyric rights', async ({ page }) => {
  await installMockSession(page);
  let quoteBody = null;
  const draft = {
    id: 'bbfd2d0d-8276-4fbb-9c4f-39f401a31582', model_id: 'ace-step-1.5',
    lyrics: '', styles: 'Dusty jazz drums, upright bass, late-night room tone',
    title: 'After Hours', revision: 8, updated_at: new Date().toISOString(),
  };
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (request.method() === 'GET' && path.endsWith('/music/sources')) return route.fulfill({ json: { sources: [] } });
    if (request.method() === 'GET' && path.endsWith('/music/drafts/custom')) return route.fulfill({ json: { draft } });
    if (request.method() === 'PUT' && path.endsWith('/music/drafts/custom')) {
      return route.fulfill({ json: { draft: { ...draft, revision: 9 } } });
    }
    if (request.method() === 'POST' && path.endsWith('/music/generation-quotes')) {
      quoteBody = request.postDataJSON();
      return route.fulfill({ status: 201, json: { ...exactQuote({ modelId: 'ace-step-1.5', unitCredits: 3 }), mode: 'custom' } });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/create?mode=custom');
  await page.getByRole('checkbox', { name: 'Create an instrumental' }).check();
  await expect(page.getByRole('checkbox', { name: /I wrote these lyrics/i })).toHaveCount(0);
  await expect(page.getByText(/saved lyrics stay in your private draft and are not sent/i)).toBeVisible();
  await page.getByRole('button', { name: 'Review Custom quote' }).click();
  await expect(page.getByRole('button', { name: 'Create two instrumental versions · 6 cr' })).toBeVisible();
  expect(quoteBody).toEqual({
    mode: 'custom', draft_revision: 9, instrumental: true,
    rights_confirmed: false, duration_seconds: 60,
  });
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F02-H4 two shared pair requests remain visible and poll independently', async ({ page }) => {
  await installMockSession(page);
  const generationBodies = [];
  let quoteCalls = 0;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) {
      return route.fulfill({ json: entitlements() });
    }
    if (request.method() === 'POST' && path.endsWith('/music/generation-quotes')) {
      quoteCalls += 1;
      return route.fulfill({ status: 201, json: exactQuote({ quoteId: quoteCalls === 1 ? QUOTE_ID : QUOTE_ID_2 }) });
    }
    if (request.method() === 'POST' && path.endsWith('/music/generations')) {
      generationBodies.push(request.postDataJSON());
      const second = generationBodies.length === 2;
      return route.fulfill({ status: 202, json: {
        generation_id: second ? GENERATION_ID_2 : GENERATION_ID,
        state: 'debited',
        balance_after: second ? 3 : 13,
        candidates: [
          { ordinal: 1, label: 'A', job_id: second ? JOB_C : JOB_A, state: 'queued' },
          { ordinal: 2, label: 'B', job_id: second ? JOB_D : JOB_B, state: 'queued' },
        ],
      } });
    }
    if (request.method() === 'GET' && (path.endsWith(`/music/generations/${GENERATION_ID}`) || path.endsWith(`/music/generations/${GENERATION_ID_2}`))) {
      const second = path.endsWith(GENERATION_ID_2);
      return route.fulfill({ json: {
        id: second ? GENERATION_ID_2 : GENERATION_ID,
        state: 'running',
        title: second ? 'Second shared pair' : 'First shared pair',
        candidates: [
          { ordinal: 1, label: 'A', job_id: second ? JOB_C : JOB_A, state: 'running' },
          { ordinal: 2, label: 'B', job_id: second ? JOB_D : JOB_B, state: 'queued' },
        ],
      } });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/create');
  await expect(page.locator('#main').getByTestId('music-credits')).toHaveText('23 cr');
  const prompt = page.getByRole('textbox', { name: /describe the sound/i });
  const title = page.getByRole('textbox', { name: /working title/i });
  await prompt.fill('First wide shared pair');
  await title.fill('First shared pair');
  await page.getByRole('button', { name: 'Review exact quote' }).click();
  await page.getByRole('button', { name: 'Create two versions · 10 cr' }).click();
  await expect(page.getByTestId(`music-generation-${GENERATION_ID}`)).toBeVisible();

  await prompt.fill('Second wide shared pair');
  await title.fill('Second shared pair');
  await page.getByRole('button', { name: 'Review exact quote' }).click();
  await page.getByRole('button', { name: 'Create two versions · 10 cr' }).click();

  await expect(page.getByTestId(`music-generation-${GENERATION_ID_2}`)).toBeVisible();
  await expect(page.getByTestId(`music-generation-${GENERATION_ID}`)).toBeVisible();
  await expect(page.getByText('Shared pairs 2/4')).toBeVisible();
  expect(generationBodies).toHaveLength(2);
  expect(generationBodies.map((body) => body.quote_id)).toEqual([QUOTE_ID, QUOTE_ID_2]);
  expect(new Set(generationBodies.map((body) => body.idempotency_key)).size).toBe(2);
});

test('F02-E7 expired confirmation returns to a fresh quote instead of trapping the user', async ({ page }) => {
  await installMockSession(page);
  let quoteCalls = 0;
  let generationCalls = 0;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (request.method() === 'POST' && path.endsWith('/music/generation-quotes')) {
      quoteCalls += 1;
      return route.fulfill({ status: 201, json: exactQuote() });
    }
    if (request.method() === 'POST' && path.endsWith('/music/generations')) {
      generationCalls += 1;
      page.expectedConsoleErrorUrls.add(request.url());
      return route.fulfill({ status: 409, json: { error: 'quote_expired' } });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/create');
  await expect(page.locator('#main').getByTestId('music-credits')).toHaveText('23 cr');
  await page.getByRole('textbox', { name: /describe the sound/i }).fill('Expired harbour quote');
  await page.getByRole('button', { name: 'Review exact quote' }).click();
  await page.getByRole('button', { name: 'Create two versions · 10 cr' }).click();
  await expect(page.getByText('That quote expired. Review a new quote before creating.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review exact quote' })).toBeVisible();
  expect(quoteCalls).toBe(1);
  expect(generationCalls).toBe(1);
  await expect(page.getByText('23 cr')).toBeVisible();
});

test('F02-E8 a transient status failure clears after polling recovers with a partial refund', async ({ page }) => {
  await installMockSession(page);
  let polls = 0;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (request.method() === 'POST' && path.endsWith('/music/generation-quotes')) return route.fulfill({ status: 201, json: exactQuote() });
    if (request.method() === 'POST' && path.endsWith('/music/generations')) {
      return route.fulfill({ status: 202, json: {
        generation_id: GENERATION_ID,
        state: 'debited',
        balance_after: 13,
        candidates: [
          { ordinal: 1, label: 'A', job_id: JOB_A, state: 'queued' },
          { ordinal: 2, label: 'B', job_id: JOB_B, state: 'queued' },
        ],
      } });
    }
    if (request.method() === 'GET' && path.endsWith(`/music/generations/${GENERATION_ID}`)) {
      polls += 1;
      if (polls === 1) {
        page.expectedConsoleErrorUrls.add(request.url());
        return route.fulfill({ status: 502, headers: { 'x-music-test-expected-error': '1' }, json: { error: 'temporarily_unavailable' } });
      }
      return route.fulfill({ json: {
        id: GENERATION_ID,
        state: 'partial',
        candidates: [
          { ordinal: 1, label: 'A', job_id: JOB_A, state: 'ready', audio_url: 'data:audio/wav;base64,UklGRg==' },
          { ordinal: 2, label: 'B', job_id: JOB_B, state: 'refunded', error_code: 'provider_failed' },
        ],
      } });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/create');
  await expect(page.locator('#main').getByTestId('music-credits')).toHaveText('23 cr');
  await page.getByRole('textbox', { name: /describe the sound/i }).fill('Recover this status request');
  await page.getByRole('button', { name: 'Review exact quote' }).click();
  await page.getByRole('button', { name: 'Create two versions · 10 cr' }).click();
  const transientError = page.getByText('Music is temporarily unavailable. No new request was confirmed.');
  await expect(transientError).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('music-candidate-a')).toHaveAttribute('data-status', 'ready', { timeout: 8_000 });
  await expect(page.getByTestId('music-candidate-b')).toHaveAttribute('data-status', 'refunded', { timeout: 8_000 });
  await expect(transientError).toHaveCount(0);
  expect(polls).toBe(2);
});

test('F02-N2 policy refusal happens before spend and editing invalidates an old quote', async ({ page }) => {
  await installMockSession(page);
  let quoteCalls = 0;
  let generationCalls = 0;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (request.method() === 'POST' && path.endsWith('/music/generation-quotes')) {
      quoteCalls += 1;
      const body = request.postDataJSON();
      if (body.prompt.includes('underage')) {
        page.expectedConsoleErrorUrls.add(request.url());
        return route.fulfill({ status: 400, json: { error: 'prompt_not_allowed', policy_version: 'music-prompt-v1' } });
      }
      expect(body.prompt.length).toBe(500);
      return route.fulfill({ status: 201, json: exactQuote() });
    }
    if (request.method() === 'POST' && path.endsWith('/music/generations')) {
      generationCalls += 1;
      return route.abort('failed');
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/create');
  await expect(page.locator('#main').getByTestId('music-credits')).toHaveText('23 cr');
  const direction = page.getByRole('textbox', { name: /describe the sound/i });
  await direction.fill('an erotic song about an underage child');
  await page.getByRole('button', { name: 'Review exact quote' }).click();
  await expect(page.getByText('That direction cannot be used. Try a different musical description.')).toBeVisible();
  await expect(page.getByText('23 cr')).toBeVisible();
  expect(generationCalls).toBe(0);

  const unicodeBoundary = `Été nocturne 🎷 ${'x'.repeat(484)}`;
  expect(unicodeBoundary.length).toBe(500);
  await direction.fill(unicodeBoundary);
  await page.getByRole('button', { name: 'Review exact quote' }).click();
  await expect(page.getByText('2 versions × 5 credits')).toBeVisible();
  await page.getByRole('textbox', { name: /working title/i }).fill('Changed after quote');
  await expect(page.getByRole('button', { name: 'Review exact quote' })).toBeVisible();
  await expect(page.getByText('Review the direction to receive an exact, short-lived quote before spending.')).toBeVisible();
  expect(quoteCalls).toBe(2);
  expect(generationCalls).toBe(0);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F02-N3 expired session and a paused rollout cannot request a quote', async ({ page }) => {
  let musicRequests = 0;
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('music-expired-session-seeded')) {
      sessionStorage.setItem('music-expired-session-seeded', '1');
      localStorage.setItem('veyrnox_supabase_session', JSON.stringify({
        access_token: 'expired-token',
        refresh_token: null,
        expires_at: Math.floor(Date.now() / 1000) - 120,
        user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      }));
    }
  });
  page.expectedConsoleText.add('[auth] turnstile check failed: 110200');
  await page.route('**/api/v1/music/**', async (route) => {
    musicRequests += 1;
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) {
      return route.fulfill({ json: { ...entitlements(), available: false } });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/create');
  await expect(page.getByText('Sign in to load your Music balance and models.')).toBeVisible();
  expect(musicRequests).toBe(0);

  await page.evaluate(() => {
    localStorage.removeItem('veyrnox_session_signed_out');
    localStorage.setItem('veyrnox_supabase_session', JSON.stringify({
      access_token: 'replacement-token',
      refresh_token: null,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    }));
  });
  await page.reload();
  const closeGate = page.getByRole('button', { name: 'Close' });
  if (await closeGate.isVisible()) await closeGate.click();
  await expect(page.getByText('Server generation is paused. You can review this screen, but no quote or spend can start.')).toBeVisible();
  await page.getByRole('textbox', { name: /describe the sound/i }).fill('Cannot spend while paused');
  await expect(page.getByRole('button', { name: 'Review exact quote' })).toBeDisabled();
  expect(musicRequests).toBe(1);
});

test('F02-E9 an ambiguous network failure retries the same confirmation key once', async ({ page }) => {
  await installMockSession(page);
  const generationBodies = [];
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (request.method() === 'POST' && path.endsWith('/music/generation-quotes')) return route.fulfill({ status: 201, json: exactQuote() });
    if (request.method() === 'POST' && path.endsWith('/music/generations')) {
      generationBodies.push(request.postDataJSON());
      if (generationBodies.length === 1) {
        page.expectedRequestFailures.add(request.url());
        page.expectedConsoleErrorUrls.add(request.url());
        return route.abort('failed');
      }
      return route.fulfill({ status: 200, json: {
        generation_id: GENERATION_ID,
        state: 'succeeded',
        balance_after: 13,
        idempotent: true,
        candidates: [
          { ordinal: 1, label: 'A', job_id: JOB_A, state: 'ready' },
          { ordinal: 2, label: 'B', job_id: JOB_B, state: 'ready' },
        ],
      } });
    }
    if (request.method() === 'GET' && path.endsWith(`/music/generations/${GENERATION_ID}`)) {
      return route.fulfill({ json: { id: GENERATION_ID, state: 'succeeded', candidates: [] } });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/create');
  await expect(page.locator('#main').getByTestId('music-credits')).toHaveText('23 cr');
  await page.getByRole('textbox', { name: /describe the sound/i }).fill('Retry safely after lost acknowledgement');
  await page.getByRole('button', { name: 'Review exact quote' }).click();
  const confirm = page.getByRole('button', { name: 'Create two versions · 10 cr' });
  await confirm.click();
  await expect(page.getByText('The network is unavailable. Your quote has not been confirmed.')).toBeVisible();
  await confirm.click();
  await expect(page.getByText('13 cr')).toBeVisible();
  expect(generationBodies).toHaveLength(2);
  expect(generationBodies[1].idempotency_key).toBe(generationBodies[0].idempotency_key);
});

test('F03-H2 Custom lyrics autosave privately, survive reload and never request generation', async ({ page }) => {
  await installMockSession(page);
  page.expectedConsoleText.add('Failed to load resource: the server responded with a status of 502 (Bad Gateway)');
  let serverDraft = {
    id: null, model_id: 'ace-step', lyrics: '', styles: '', title: '', revision: 0, updated_at: null,
  };
  let draftReads = 0;
  let generationCalls = 0;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'GET') {
      draftReads += 1;
      if (draftReads === 1) {
        return route.fulfill({
          status: 502,
          headers: { 'x-music-test-expected-error': '1' },
          json: { error: 'temporarily_unavailable' },
        });
      }
      return route.fulfill({ json: { draft: serverDraft } });
    }
    if (path.endsWith('/music/drafts/custom') && request.method() === 'PUT') {
      const body = request.postDataJSON();
      expect(body.revision).toBe(serverDraft.revision);
      serverDraft = {
        id: serverDraft.id || 'e9ed2d0d-8276-4fbb-9c4f-39f401a3158f',
        model_id: body.model_id,
        lyrics: body.lyrics,
        styles: body.styles,
        title: body.title,
        revision: serverDraft.revision + 1,
        updated_at: new Date().toISOString(),
      };
      return route.fulfill({ json: { draft: serverDraft } });
    }
    if (path.includes('/generation')) generationCalls += 1;
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/music/create');
  await expect(page.getByText('Three deliberate steps, no surprise spend.')).toBeVisible();
  await page.getByRole('region', { name: 'Create guide' }).getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByText('Three deliberate steps, no surprise spend.')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Custom' }).click();
  await expect(page.getByText('The private draft could not be loaded. Retry before editing.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: /original lyrics or structure/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry draft load' }).click();
  await expect(page.getByText('Saved privately · revision 0')).toBeVisible();
  await page.getByRole('button', { name: 'Focus lyrics' }).click();
  const lyricsDialog = page.getByRole('dialog', { name: 'Focus lyrics' });
  await expect(lyricsDialog).toBeVisible();
  await lyricsDialog.getByRole('button', { name: '[Verse]', exact: true }).click();
  await lyricsDialog.getByRole('textbox', { name: /original lyrics or structure/i }).fill('[Verse]\nCafé lights, déjà vu ✨');
  await lyricsDialog.getByRole('button', { name: '[Chorus]', exact: true }).click();
  await expect(lyricsDialog.getByRole('textbox', { name: /original lyrics or structure/i })).toHaveValue('[Verse]\nCafé lights, déjà vu ✨\n[Chorus]\n');
  await lyricsDialog.getByRole('textbox', { name: /original lyrics or structure/i }).evaluate((node) => {
    const start = node.value.indexOf('lights');
    node.setSelectionRange(start, start + 6);
  });
  await lyricsDialog.getByRole('button', { name: 'Find rhyme & line references' }).click();
  const writingReferences = lyricsDialog.getByRole('complementary', { name: 'Writing references' });
  await expect(writingReferences).toContainText('lights');
  await expect(writingReferences).toContainText('night · sight · height · bright');
  await page.keyboard.press('Escape');
  await expect(lyricsDialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Focus lyrics' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Style direction' }).fill('Warm piano, restrained percussion, 84 bpm');
  await page.getByRole('button', { name: 'Expand style direction' }).click();
  await expect(page.getByRole('textbox', { name: 'Style direction' })).toHaveValue(/wide stereo space with a close, intimate centre/);
  await page.getByRole('textbox', { name: /working title/i }).fill('Harbour Frame');
  await expect(page.getByText('Saved privately · revision 1')).toBeVisible({ timeout: 5_000 });
  expect(serverDraft.lyrics).toBe('[Verse]\nCafé lights, déjà vu ✨\n[Chorus]\n');
  expect(serverDraft.styles).toBe('Warm piano, restrained percussion, 84 bpm; wide stereo space with a close, intimate centre');
  expect(serverDraft.title).toBe('Harbour Frame');
  expect(generationCalls).toBe(0);
  await expect(page.getByRole('button', { name: 'Custom generation unavailable for this model' })).toBeDisabled();
  await page.screenshot({ path: 'replica/suno/clone-screens/S06-server-mobile.png', fullPage: true });

  await page.reload();
  await expect(page.getByText('Three deliberate steps, no surprise spend.')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Custom' }).click();
  await expect(page.getByRole('textbox', { name: /original lyrics or structure/i })).toHaveValue('[Verse]\nCafé lights, déjà vu ✨\n[Chorus]\n');
  await expect(page.getByRole('textbox', { name: 'Style direction' })).toHaveValue('Warm piano, restrained percussion, 84 bpm; wide stereo space with a close, intimate centre');
  await expect(page.getByRole('textbox', { name: /working title/i })).toHaveValue('Harbour Frame');
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F03-H5 lyric co-writing saves first and opens an unsent priced Chat draft', async ({ page }) => {
  await installMockSession(page);
  let generationCalls = 0;
  let serverDraft = {
    id: null, model_id: 'ace-step', lyrics: '', styles: '', title: '', revision: 0, updated_at: null,
  };
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'GET') return route.fulfill({ json: { draft: serverDraft } });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'PUT') {
      const body = request.postDataJSON();
      serverDraft = {
        id: serverDraft.id || 'e9ed2d0d-8276-4fbb-9c4f-39f401a3158f',
        model_id: body.model_id,
        lyrics: body.lyrics,
        styles: body.styles,
        title: body.title,
        revision: serverDraft.revision + 1,
        updated_at: new Date().toISOString(),
      };
      return route.fulfill({ json: { draft: serverDraft } });
    }
    if (path.includes('/generation')) generationCalls += 1;
    return route.abort('failed');
  });
  await page.route('**/api/v1/chat/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/chat/models')) return route.fulfill({ json: {
      models: [{ id: 'chat-fast', name: 'Fast', maker: 'other', maker_label: 'Other', credits_per_reply: 2, gated: false, max_reply_tokens: 1024, options: { thinking: null, web: null, images: null, research: null } }],
      max_reply_tokens: 1024, max_attachments: 4, max_image_edge: 2048,
    } });
    if (request.method() === 'GET' && path.endsWith('/chat/threads')) return route.fulfill({ json: { threads: [] } });
    if (request.method() === 'GET' && path.endsWith('/chat/folders')) return route.fulfill({ json: { folders: [] } });
    if (request.method() === 'GET' && path.endsWith('/chat/personas')) return route.fulfill({ json: { enabled: false, personas: [] } });
    return route.abort('failed');
  });
  await page.route('**/api/v1/account', (route) => route.fulfill({ json: { balance: 23, free_credits: 3, free_expires_at: null, asset_count: 0, email: 'writer@example.com' } }));
  await page.route('**/api/v1/free-allowance', (route) => route.fulfill({ json: { enabled: false, left: {} } }));
  await page.route('**/api/catalog', (route) => route.fulfill({ json: { models: [] } }));

  await page.goto('/app/music/create');
  await page.getByRole('tab', { name: 'Custom' }).click();
  await expect(page.getByText('Saved privately · revision 0')).toBeVisible();
  await page.getByRole('textbox', { name: /original lyrics or structure/i }).fill('[Verse]\nHarbour lights hold still\n[Chorus]\nBring me home');
  await page.getByRole('textbox', { name: 'What should Chat help with?' }).fill('Tighten the chorus, keep the harbour image, and make the final line more hopeful.');
  await page.getByRole('button', { name: 'Open lyric assistant in Chat' }).click();

  await expect(page).toHaveURL(/\/app\/chat\?from=music$/);
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(/Help me co-write original song lyrics/);
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(/Tighten the chorus, keep the harbour image/);
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(/Harbour lights hold still/);
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(/BEGIN REVISED LYRICS/);
  await expect(page.getByRole('button', { name: 'Send · 2 Credits' })).toBeVisible();
  expect(serverDraft.revision).toBe(1);
  expect(serverDraft.lyrics).toContain('Harbour lights hold still');
  expect(generationCalls).toBe(0);
});

test('F03-H6 a delimited Chat reply returns for explicit revision-safe lyric review', async ({ page }) => {
  await installMockSession(page);
  let serverDraft = {
    id: 'e9ed2d0d-8276-4fbb-9c4f-39f401a3158f', model_id: 'ace-step',
    lyrics: '[Verse]\nHarbour lights hold still', styles: '', title: '', revision: 7, updated_at: new Date().toISOString(),
  };
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'GET') return route.fulfill({ json: { draft: serverDraft } });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'PUT') {
      const body = request.postDataJSON();
      expect(body.revision).toBe(serverDraft.revision);
      serverDraft = { ...serverDraft, ...body, revision: serverDraft.revision + 1, updated_at: new Date().toISOString() };
      return route.fulfill({ json: { draft: serverDraft } });
    }
    return route.abort('failed');
  });
  await page.route('**/api/v1/chat/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/chat/models')) return route.fulfill({ json: {
      models: [{ id: 'chat-fast', name: 'Fast', maker: 'other', maker_label: 'Other', credits_per_reply: 2, gated: false, max_reply_tokens: 1024, options: { thinking: null, web: null, images: null, research: null } }],
      max_reply_tokens: 1024, max_attachments: 4, max_image_edge: 2048,
    } });
    if (request.method() === 'GET' && path.endsWith(`/chat/threads/${CHAT_THREAD}`)) return route.fulfill({ json: {
      thread: { id: CHAT_THREAD, title: 'Lyric return', model_id: 'chat-fast', system_prompt: '', folder_id: null, pinned: false },
      messages: [
        { id: 'user-lyric', role: 'user', content: 'Tighten the chorus.', status: 'complete', credits: 0 },
        { id: 'assistant-lyric', role: 'assistant', content: 'BEGIN REVISED LYRICS\n[Verse]\nHarbour lights lean toward dawn\n[Chorus]\nCarry me home in the morning\nEND REVISED LYRICS', status: 'complete', credits: 2 },
      ],
    } });
    if (request.method() === 'GET' && path.endsWith('/chat/threads')) return route.fulfill({ json: { threads: [{ id: CHAT_THREAD, title: 'Lyric return', model_id: 'chat-fast', folder_id: null, pinned: false }] } });
    if (request.method() === 'GET' && path.endsWith('/chat/folders')) return route.fulfill({ json: { folders: [] } });
    if (request.method() === 'GET' && path.endsWith('/chat/personas')) return route.fulfill({ json: { enabled: false, personas: [] } });
    return route.abort('failed');
  });
  await page.route('**/api/v1/account', (route) => route.fulfill({ json: { balance: 23, free_credits: 3, free_expires_at: null, asset_count: 0, email: 'writer@example.com' } }));
  await page.route('**/api/v1/free-allowance', (route) => route.fulfill({ json: { enabled: false, left: {} } }));
  await page.route('**/api/catalog', (route) => route.fulfill({ json: { models: [] } }));

  await page.goto('/app/music/create');
  await page.evaluate(({ userId, draft }) => {
    sessionStorage.setItem('veyrnox.music.lyric-handoff.v1', JSON.stringify({
      v: 1, user_id: userId, source_revision: draft.revision, source_lyrics: draft.lyrics,
      request: 'Tighten the chorus.', created_at: Date.now(),
    }));
  }, { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', draft: serverDraft });
  await page.goto('/app/chat?from=music');
  const lyricThread = page.getByRole('button', { name: 'Lyric return', exact: true });
  await lyricThread.focus();
  await lyricThread.press('Enter');
  await page.getByRole('button', { name: 'Review in Music' }).click();

  await expect(page).toHaveURL(/\/app\/music\/create\?mode=custom&lyricReturn=1$/);
  const review = page.getByRole('region', { name: 'Review assistant lyrics' });
  await expect(review).toContainText('Nothing has changed yet.');
  await expect(review.getByRole('textbox', { name: 'Assistant proposal' })).toHaveValue('[Verse]\nHarbour lights lean toward dawn\n[Chorus]\nCarry me home in the morning');
  await review.getByRole('button', { name: 'Apply assistant draft' }).click();
  await expect(page.getByText('Saved privately · revision 8')).toBeVisible({ timeout: 5_000 });
  expect(serverDraft.lyrics).toContain('Carry me home in the morning');
  expect(await page.evaluate(() => sessionStorage.getItem('veyrnox.music.lyric-handoff.v1'))).toBeNull();
});

test('F03-H7 private Lyricist profiles require owned examples, delete cleanly and shape the next Chat', async ({ page }) => {
  await installMockSession(page);
  const prefix = 'Veyrnox Music lyricist profile v1.';
  let profiles = [{ id: LYRICIST_OLD, name: 'Lyricist · Archive', instructions: `${prefix}\nOld private example`, model_id: null, thinking: false, web: false }];
  const serverDraft = { id: 'e9ed2d0d-8276-4fbb-9c4f-39f401a3158f', model_id: 'ace-step', lyrics: '[Verse]\nHarbour light', styles: '', title: '', revision: 3, updated_at: new Date().toISOString() };
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'GET') return route.fulfill({ json: { draft: serverDraft } });
    return route.abort('failed');
  });
  await page.route('**/api/v1/chat/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith(`/chat/personas/${LYRICIST_OLD}`) && request.method() === 'DELETE') { profiles = profiles.filter((item) => item.id !== LYRICIST_OLD); return route.fulfill({ json: { ok: true } }); }
    if (path.endsWith('/chat/personas') && request.method() === 'POST') {
      const body = request.postDataJSON();
      expect(body.name).toBe('Lyricist · Harbour voice');
      expect(body.instructions).toContain('The user attested that they wrote or own');
      expect(body.instructions).toContain('BEGIN PRIVATE OWNED EXAMPLES');
      const persona = { id: LYRICIST_NEW, ...body };
      profiles.push(persona);
      return route.fulfill({ status: 201, json: { persona } });
    }
    if (path.endsWith('/chat/personas') && request.method() === 'GET') return route.fulfill({ json: { enabled: true, personas: profiles } });
    if (path.endsWith('/chat/models') && request.method() === 'GET') return route.fulfill({ json: {
      models: [{ id: 'chat-fast', name: 'Fast', maker: 'other', maker_label: 'Other', credits_per_reply: 2, gated: false, max_reply_tokens: 1024, options: { thinking: null, web: null, images: null, research: null } }],
      max_reply_tokens: 1024, max_attachments: 4, max_image_edge: 2048,
    } });
    if (path.endsWith('/chat/threads') && request.method() === 'GET') return route.fulfill({ json: { threads: [] } });
    if (path.endsWith('/chat/folders') && request.method() === 'GET') return route.fulfill({ json: { folders: [] } });
    return route.abort('failed');
  });
  await page.route('**/api/v1/account', (route) => route.fulfill({ json: { balance: 23, free_credits: 3, free_expires_at: null, asset_count: 0, email: 'writer@example.com' } }));
  await page.route('**/api/v1/free-allowance', (route) => route.fulfill({ json: { enabled: false, left: {} } }));
  await page.route('**/api/catalog', (route) => route.fulfill({ json: { models: [] } }));

  await page.goto('/app/music/create');
  await page.getByRole('tab', { name: 'Custom' }).click();
  await page.getByRole('button', { name: 'Choose or create' }).click();
  const profileRegion = page.getByRole('region', { name: 'Lyricist profiles' });
  await profileRegion.getByRole('button', { name: 'Delete' }).click();
  await profileRegion.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(profileRegion.getByText('Archive')).toHaveCount(0);
  await profileRegion.getByRole('button', { name: 'New Lyricist profile' }).click();
  await profileRegion.getByRole('textbox', { name: 'Profile name' }).fill('Harbour voice');
  await profileRegion.getByRole('textbox', { name: 'Broad writing direction' }).fill('Concrete coastal images, restrained language, short internal rhymes.');
  await profileRegion.getByRole('textbox', { name: 'Examples you wrote or own' }).fill('[Verse]\nSalt on the rail, dawn in the glass');
  await expect(profileRegion.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  await profileRegion.getByRole('checkbox', { name: /I wrote or own these examples/ }).check();
  await profileRegion.getByRole('button', { name: 'Save profile' }).click();
  await expect(profileRegion.getByRole('combobox', { name: 'Profile for the next Chat' })).toHaveValue(LYRICIST_NEW);
  await page.getByRole('textbox', { name: 'What should Chat help with?' }).fill('Make the final image feel hopeful.');
  await page.getByRole('button', { name: 'Open lyric assistant in Chat' }).click();

  await expect(page).toHaveURL(/\/app\/chat\?from=music$/);
  await page.getByRole('button', { name: 'Settings' }).click();
  const chatSettings = page.getByRole('region', { name: 'Chat settings' });
  await chatSettings.getByRole('button', { name: 'Persona', exact: true }).click();
  await expect(chatSettings.getByRole('combobox', { name: 'Persona' })).toHaveValue(LYRICIST_NEW);
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(/Make the final image feel hopeful/);
  await expect(page.getByRole('button', { name: 'Send · 2 Credits' })).toBeVisible();
});

test('F03-H8 selected lyric lines return from Chat and replace only the captured range', async ({ page }) => {
  await installMockSession(page);
  const originalLyrics = '[Verse]\nKeep this opening\nChange only this line\nKeep this ending';
  let serverDraft = {
    id: 'e9ed2d0d-8276-4fbb-9c4f-39f401a3158f', model_id: 'ace-step',
    lyrics: originalLyrics, styles: '', title: '', revision: 9, updated_at: new Date().toISOString(),
  };
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'GET') return route.fulfill({ json: { draft: serverDraft } });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'PUT') {
      const body = request.postDataJSON();
      expect(body.revision).toBe(serverDraft.revision);
      serverDraft = { ...serverDraft, ...body, revision: serverDraft.revision + 1, updated_at: new Date().toISOString() };
      return route.fulfill({ json: { draft: serverDraft } });
    }
    return route.abort('failed');
  });
  await page.route('**/api/v1/chat/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/chat/models')) return route.fulfill({ json: {
      models: [{ id: 'chat-fast', name: 'Fast', maker: 'other', maker_label: 'Other', credits_per_reply: 2, gated: false, max_reply_tokens: 1024, options: { thinking: null, web: null, images: null, research: null } }],
      max_reply_tokens: 1024, max_attachments: 4, max_image_edge: 2048,
    } });
    if (request.method() === 'GET' && path.endsWith(`/chat/threads/${CHAT_THREAD}`)) return route.fulfill({ json: {
      thread: { id: CHAT_THREAD, title: 'Selected-line return', model_id: 'chat-fast', system_prompt: '', folder_id: null, pinned: false },
      messages: [
        { id: 'user-selection', role: 'user', content: 'Make this image more vivid.', status: 'complete', credits: 0 },
        { id: 'assistant-selection', role: 'assistant', content: 'BEGIN REPLACEMENT LINES\nDawn catches fire on the rail\nEND REPLACEMENT LINES', status: 'complete', credits: 2 },
      ],
    } });
    if (request.method() === 'GET' && path.endsWith('/chat/threads')) return route.fulfill({ json: { threads: [{ id: CHAT_THREAD, title: 'Selected-line return', model_id: 'chat-fast', folder_id: null, pinned: false }] } });
    if (request.method() === 'GET' && path.endsWith('/chat/folders')) return route.fulfill({ json: { folders: [] } });
    if (request.method() === 'GET' && path.endsWith('/chat/personas')) return route.fulfill({ json: { enabled: false, personas: [] } });
    return route.abort('failed');
  });
  await page.route('**/api/v1/account', (route) => route.fulfill({ json: { balance: 23, free_credits: 3, free_expires_at: null, asset_count: 0, email: 'writer@example.com' } }));
  await page.route('**/api/v1/free-allowance', (route) => route.fulfill({ json: { enabled: false, left: {} } }));
  await page.route('**/api/catalog', (route) => route.fulfill({ json: { models: [] } }));

  await page.goto('/app/music/create');
  await page.getByRole('tab', { name: 'Custom' }).click();
  await page.getByRole('button', { name: 'Focus lyrics' }).click();
  const dialog = page.getByRole('dialog', { name: 'Focus lyrics' });
  await dialog.getByRole('textbox', { name: 'Change request' }).fill('Make this image more vivid.');
  const editor = dialog.getByRole('textbox', { name: /original lyrics or structure/i });
  await editor.evaluate((node) => {
    const start = node.value.indexOf('Change only this line');
    node.focus();
    node.setSelectionRange(start, start + 'Change only this line'.length);
  });
  await dialog.getByRole('button', { name: 'Edit selected lines in Chat' }).click();

  await expect(page).toHaveURL(/\/app\/chat\?from=music$/);
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(/SELECTED RANGE\nChange only this line\nEND SELECTED RANGE/);
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(/BEGIN REPLACEMENT LINES/);
  const returnThread = page.getByRole('button', { name: 'Selected-line return', exact: true });
  await returnThread.focus();
  await returnThread.press('Enter');
  await page.getByRole('button', { name: 'Review in Music' }).click();

  await expect(page).toHaveURL(/\/app\/music\/create\?mode=custom&lyricReturn=1$/);
  const review = page.getByRole('region', { name: 'Review assistant lyrics' });
  await expect(review).toContainText('Review the selected-line replacement.');
  await expect(review.getByRole('textbox', { name: 'Replacement lines' })).toHaveValue('Dawn catches fire on the rail');
  await review.getByRole('button', { name: 'Apply selected-line replacement' }).click();
  await expect(page.getByText('Saved privately · revision 10')).toBeVisible({ timeout: 5_000 });
  expect(serverDraft.lyrics).toBe('[Verse]\nKeep this opening\nDawn catches fire on the rail\nKeep this ending');
  expect(await page.evaluate(() => sessionStorage.getItem('veyrnox.music.lyric-handoff.v1'))).toBeNull();
});

test('F03-E2 two Custom tabs merge non-overlapping edits without losing either draft', async ({ page, context }) => {
  await installMockSession(page);
  let serverDraft = {
    id: null, model_id: 'ace-step', lyrics: '', styles: '', title: '', revision: 0, updated_at: null,
  };
  await context.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'GET') return route.fulfill({ json: { draft: { ...serverDraft } } });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'PUT') {
      const body = request.postDataJSON();
      if (body.revision !== serverDraft.revision) {
        return route.fulfill({ status: 409, json: { error: 'revision_conflict', draft: { ...serverDraft } } });
      }
      serverDraft = {
        id: serverDraft.id || 'e9ed2d0d-8276-4fbb-9c4f-39f401a3158f',
        model_id: body.model_id,
        lyrics: body.lyrics,
        styles: body.styles,
        title: body.title,
        revision: serverDraft.revision + 1,
        updated_at: new Date().toISOString(),
      };
      return route.fulfill({ json: { draft: { ...serverDraft } } });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/create');
  const second = await context.newPage();
  await second.addInitScript(() => {
    localStorage.setItem('veyrnox_supabase_session', JSON.stringify({
      access_token: 'mock-browser-token', refresh_token: null,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    }));
  });
  await second.goto('/app/music/create');
  await page.getByRole('tab', { name: 'Custom' }).click();
  await second.getByRole('tab', { name: 'Custom' }).click();
  await expect(page.getByText('Saved privately · revision 0')).toBeVisible();
  await expect(second.getByText('Saved privately · revision 0')).toBeVisible();

  await page.getByRole('textbox', { name: /original lyrics or structure/i }).fill('[Verse]\nDraft from tab A');
  await expect(page.getByText('Saved privately · revision 1')).toBeVisible({ timeout: 5_000 });
  await second.getByRole('textbox', { name: 'Style direction' }).fill('Direction from tab B');
  await expect(second.getByText('Saved privately · revision 2')).toBeVisible({ timeout: 5_000 });
  await expect(second.getByRole('textbox', { name: /original lyrics or structure/i })).toHaveValue('[Verse]\nDraft from tab A');
  await expect(second.getByRole('textbox', { name: 'Style direction' })).toHaveValue('Direction from tab B');
  await expect(second.getByText('A newer server draft exists.')).toHaveCount(0);
  expect(serverDraft.lyrics).toBe('[Verse]\nDraft from tab A');
  expect(serverDraft.styles).toBe('Direction from tab B');
  await second.close();
});

test('F03-E3 same-field conflicts keep both versions visible until the user chooses', async ({ page, context }) => {
  await installMockSession(page);
  let serverDraft = {
    id: null, model_id: 'ace-step', lyrics: '', styles: '', title: '', revision: 0, updated_at: null,
  };
  await context.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'GET') return route.fulfill({ json: { draft: { ...serverDraft } } });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'PUT') {
      const body = request.postDataJSON();
      if (body.revision !== serverDraft.revision) {
        return route.fulfill({ status: 409, json: { error: 'revision_conflict', draft: { ...serverDraft } } });
      }
      serverDraft = {
        id: serverDraft.id || 'e9ed2d0d-8276-4fbb-9c4f-39f401a3158f',
        model_id: body.model_id,
        lyrics: body.lyrics,
        styles: body.styles,
        title: body.title,
        revision: serverDraft.revision + 1,
        updated_at: new Date().toISOString(),
      };
      return route.fulfill({ json: { draft: { ...serverDraft } } });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/create');
  const second = await context.newPage();
  await installMockSession(second);
  await second.goto('/app/music/create');
  await page.getByRole('tab', { name: 'Custom' }).click();
  await second.getByRole('tab', { name: 'Custom' }).click();
  await expect(page.getByText('Saved privately · revision 0')).toBeVisible();
  await expect(second.getByText('Saved privately · revision 0')).toBeVisible();

  await page.getByRole('textbox', { name: /original lyrics or structure/i }).fill('Server-side lyric from tab A');
  await expect(page.getByText('Saved privately · revision 1')).toBeVisible({ timeout: 5_000 });
  await second.getByRole('textbox', { name: /original lyrics or structure/i }).fill('Local lyric from tab B');
  await expect(second.getByText('A newer server draft exists.')).toBeVisible({ timeout: 5_000 });
  await expect(second.getByRole('textbox', { name: 'Your lyrics' })).toHaveValue('Local lyric from tab B');
  await expect(second.getByRole('textbox', { name: 'Server lyrics' })).toHaveValue('Server-side lyric from tab A');
  await expect(second.getByRole('textbox', { name: /original lyrics or structure/i })).toHaveValue('Local lyric from tab B');
  const accessibility = await new AxeBuilder({ page: second }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);

  await second.getByRole('button', { name: 'Keep my version' }).click();
  await expect(second.getByText('Saved privately · revision 2')).toBeVisible({ timeout: 5_000 });
  expect(serverDraft.lyrics).toBe('Local lyric from tab B');
  await second.close();
});

test('F03-E4 a failed autosave preserves the draft and retries without a duplicate revision', async ({ page }) => {
  await installMockSession(page);
  page.expectedConsoleText.add('Failed to load resource: the server responded with a status of 502 (Bad Gateway)');
  let serverDraft = {
    id: null, model_id: 'ace-step', lyrics: '', styles: '', title: '', revision: 0, updated_at: null,
  };
  let saves = 0;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'GET') return route.fulfill({ json: { draft: { ...serverDraft } } });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'PUT') {
      saves += 1;
      if (saves === 1) {
        return route.fulfill({
          status: 502,
          headers: { 'x-music-test-expected-error': '1' },
          json: { error: 'temporarily_unavailable' },
        });
      }
      const body = request.postDataJSON();
      expect(body.revision).toBe(0);
      serverDraft = {
        id: 'e9ed2d0d-8276-4fbb-9c4f-39f401a3158f',
        model_id: body.model_id,
        lyrics: body.lyrics,
        styles: body.styles,
        title: body.title,
        revision: 1,
        updated_at: new Date().toISOString(),
      };
      return route.fulfill({ json: { draft: { ...serverDraft } } });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/create');
  await page.getByRole('tab', { name: 'Custom' }).click();
  const style = page.getByRole('textbox', { name: 'Style direction' });
  await style.fill('Do not lose this direction');
  await expect(page.getByText('The draft could not be saved. Your text remains on this page.')).toBeVisible({ timeout: 5_000 });
  await expect(style).toHaveValue('Do not lose this direction');
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByText('Saved privately · revision 1')).toBeVisible({ timeout: 5_000 });
  expect(saves).toBe(2);
  expect(serverDraft.styles).toBe('Do not lose this direction');
});

test('F03-E5 maximum safe draft fields round-trip as text and never execute markup', async ({ page }) => {
  await installMockSession(page);
  let serverDraft = {
    id: null, model_id: 'ace-step', lyrics: '', styles: '', title: '', revision: 0, updated_at: null,
  };
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'GET') return route.fulfill({ json: { draft: { ...serverDraft } } });
    if (path.endsWith('/music/drafts/custom') && request.method() === 'PUT') {
      const body = request.postDataJSON();
      serverDraft = {
        id: 'e9ed2d0d-8276-4fbb-9c4f-39f401a3158f',
        model_id: body.model_id,
        lyrics: body.lyrics,
        styles: body.styles,
        title: body.title,
        revision: serverDraft.revision + 1,
        updated_at: new Date().toISOString(),
      };
      return route.fulfill({ json: { draft: { ...serverDraft } } });
    }
    return route.abort('failed');
  });

  const prefix = '<script>window.__musicInjected=true</script>\nCafé ✨\n';
  const lyrics = (prefix + 'x'.repeat(3000)).slice(0, 3000);
  const styles = ('Électro-acoustic ✨ ' + 's'.repeat(500)).slice(0, 500);
  const title = ('Déjà vu ✨ ' + 't'.repeat(80)).slice(0, 80);
  await page.goto('/app/music/create');
  await page.getByRole('tab', { name: 'Custom' }).click();
  const lyricsField = page.getByRole('textbox', { name: /original lyrics or structure/i });
  await lyricsField.fill(lyrics);
  await page.getByRole('textbox', { name: 'Style direction' }).fill(styles);
  await page.getByRole('textbox', { name: /working title/i }).fill(title);
  await expect(page.getByText('Saved privately · revision 1')).toBeVisible({ timeout: 5_000 });
  expect(serverDraft.lyrics).toBe(lyrics);
  expect(serverDraft.styles).toBe(styles);
  expect(serverDraft.title).toBe(title);
  expect(await page.evaluate(() => window.__musicInjected)).toBeUndefined();
  await lyricsField.press('End');
  await lyricsField.press('z');
  await expect(lyricsField).toHaveValue(lyrics);

  await page.reload();
  await page.getByRole('tab', { name: 'Custom' }).click();
  await expect(page.getByRole('textbox', { name: /original lyrics or structure/i })).toHaveValue(lyrics);
  await expect(page.getByRole('textbox', { name: 'Style direction' })).toHaveValue(styles);
  await expect(page.getByRole('textbox', { name: /working title/i })).toHaveValue(title);
});

test('F04-H1 Music Sounds requests a provider-backed seamless loop without inventing BPM or key controls', async ({ page }) => {
  await installMockSession(page);
  let generation = null;
  await page.route('**/api/catalog', (route) => route.fulfill({ json: { models: [{
    id: 'elevenlabs-sfx-v2', name: 'ElevenLabs Sound Effects', modality: 'text-to-audio', credits: 2, gated: false,
    durations: [5], capabilities: { kind: 'audio', lengths: [5], inputs: { prompt: { type: 'string', max: 10_000 }, loop: { type: 'bool' } }, media: {} },
  }, {
    id: 'mmaudio-v2', name: 'MMAudio v2', modality: 'text-to-audio', credits: 1, gated: false,
    durations: [5], capabilities: { kind: 'audio', lengths: [5], inputs: { prompt: { type: 'string', max: 10_000 } }, media: {} },
  }] } }));
  await page.route('**/api/v1/balance', (route) => route.fulfill({ json: { balance: 23 } }));
  await page.route('**/api/v1/account', (route) => route.fulfill({ json: { balance: 23, asset_count: 0, email: 'sound@example.com' } }));
  await page.route('**/api/v1/free-allowance', (route) => route.fulfill({ json: { enabled: false, left: {} } }));
  await page.route('**/api/v1/generations', async (route) => {
    generation = route.request().postDataJSON();
    return route.fulfill({ status: 402, json: { error: 'insufficient_balance' } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/music/sounds');
  await expect(page.getByRole('heading', { name: 'Create a sound or seamless loop.' })).toBeVisible();
  const eleven = page.getByRole('link', { name: 'Open sound and loop generator' });
  await expect(eleven).toHaveAttribute('href', '/app/create?model=elevenlabs-sfx-v2');
  await expect(page.getByRole('link', { name: 'Open soundscape generator' })).toHaveAttribute('href', '/app/create?model=mmaudio-v2');
  await expect(page.getByRole('heading', { name: 'Looping is available on ElevenLabs Sound Effects.' })).toBeVisible();
  await expect(page.getByText(/BPM and musical key are prompt directions/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await eleven.click();
  await expect(page).toHaveURL(/model=elevenlabs-sfx-v2/);
  const modelPicker = page.getByRole('combobox', { name: 'Generation model' });
  await expect(modelPicker).toHaveValue('elevenlabs-sfx-v2');
  await page.getByText('SETTINGS', { exact: true }).click();
  const loop = page.getByRole('checkbox', { name: /Seamless loop/ });
  await expect(loop).toBeVisible();
  await loop.check();
  await page.getByRole('textbox', { name: 'Prompt' }).fill('Soft rain on a canvas awning at night');
  page.expectedConsoleText.add('Failed to load resource: the server responded with a status of 402 (Payment Required)');
  await page.getByRole('button', { name: 'Generate for 2 credits' }).click();
  await expect.poll(() => generation).not.toBeNull();
  expect(generation.model_id).toBe('elevenlabs-sfx-v2');
  expect(generation.inputs).toEqual({ prompt: 'Soft rain on a canvas awning at night', loop: true });
  await expect(page.getByText(/Not enough credits for this generation/)).toBeVisible();

  await modelPicker.selectOption('mmaudio-v2');
  await expect(page.getByRole('checkbox', { name: /Seamless loop/ })).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F05-H1 owned audio is rights-bound, verified privately and cannot reach an incompatible model', async ({ page }) => {
  await installMockSession(page);
  const sourceId = 'c1ed2d0d-8276-4fbb-9c4f-39f401a3158a';
  const mutations = [];
  let uploadPuts = 0;
  await page.route('https://fb18d9f7052afbea5a5e0eae69948af2.r2.cloudflarestorage.com/**', async (route) => {
    uploadPuts += 1;
    expect(route.request().method()).toBe('PUT');
    expect(route.request().headers()['content-type']).toBe('audio/mpeg');
    return route.fulfill({ status: 200, body: '' });
  });
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (path.endsWith('/music/sources') && request.method() === 'GET') return route.fulfill({ json: { sources: [] } });
    if (path.endsWith('/music/sources') && request.method() === 'POST') {
      const body = request.postDataJSON();
      mutations.push(body);
      if (body.action === 'reserve') return route.fulfill({ status: 201, json: {
        id: sourceId,
        upload_url: 'https://fb18d9f7052afbea5a5e0eae69948af2.r2.cloudflarestorage.com/private-source',
        content_type: 'audio/mpeg',
        headers: { 'x-upload-contract': 'owned-audio' },
        idempotent: false,
      } });
      return route.fulfill({ json: { source: {
        id: sourceId,
        filename: 'owned-demo.mp3',
        mime_type: 'audio/mpeg',
        size_bytes: 3,
        duration_seconds: 125,
        status: 'ready',
        rights_statement_version: 'music-source-rights-v1',
        preview_url: 'https://downloads.example/owned-demo.mp3',
      }, idempotent: false } });
    }
    if (path.endsWith('/music/sources') && request.method() === 'DELETE') return route.fulfill({ json: { ok: true } });
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/music/create');
  await page.getByRole('button', { name: 'Add owned audio' }).click();
  const upload = page.getByRole('button', { name: 'Upload and verify' });
  await page.getByLabel('Choose owned audio').setInputFiles({
    name: 'owned-demo.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('ID3'),
  });
  await expect(upload).toBeDisabled();
  await page.getByText(/I own or have permission/).click();
  await expect(upload).toBeEnabled();
  await upload.click();
  await expect(page.getByText('owned-demo.mp3', { exact: true })).toBeVisible();
  await expect(page.getByText('2:05 · rights v1')).toBeVisible();
  await expect(page.getByText(/source is attached privately/i)).toBeVisible();
  await page.getByRole('textbox', { name: /describe the sound/i }).fill('Rework my owned source with restrained percussion');
  await expect(page.getByRole('button', { name: 'Review exact quote' })).toBeDisabled();
  expect(uploadPuts).toBe(1);
  expect(mutations).toHaveLength(2);
  expect(mutations[0]).toEqual({
    action: 'reserve',
    content_type: 'audio/mpeg',
    filename: 'owned-demo.mp3',
    idempotency_key: expect.stringMatching(/^source\./),
    rights_confirmed: true,
    size_bytes: 3,
  });
  expect(mutations[1]).toEqual({ action: 'complete', id: sourceId });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F05-H2 microphone permission starts only on intent and prepares a real WAV source', async ({ page }) => {
  await installMockSession(page);
  await page.addInitScript(() => {
    window.__musicMicrophoneRequests = 0;
    const track = { stop() {} };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      async getUserMedia() {
        window.__musicMicrophoneRequests += 1;
        return { getTracks: () => [track] };
      },
    } });
    class FakeMediaRecorder {
      static isTypeSupported() { return true; }
      constructor() { this.mimeType = 'audio/webm;codecs=opus'; this.state = 'inactive'; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) });
          this.onstop?.();
        });
      }
    }
    class FakeAudioContext {
      async decodeAudioData() {
        const samples = new Float32Array([0, 0.25, -0.25, 0]);
        return { numberOfChannels: 1, length: samples.length, sampleRate: 8_000, getChannelData: () => samples };
      }
      async close() {}
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FakeMediaRecorder });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  });
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (request.method() === 'GET' && path.endsWith('/music/sources')) return route.fulfill({ json: { sources: [] } });
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/music/create');
  await page.getByRole('button', { name: 'Add owned audio' }).click();
  expect(await page.evaluate(() => window.__musicMicrophoneRequests)).toBe(0);
  await page.getByRole('button', { name: 'Record with microphone' }).click();
  expect(await page.evaluate(() => window.__musicMicrophoneRequests)).toBe(1);
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByText(/Selected: veyrnox-recording\.wav/)).toBeVisible();
  await expect(page.getByText(/Recording prepared as WAV/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload and verify' })).toBeDisabled();
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F05-E1 ambiguous completion reuses one reservation and converges without overwriting bytes', async ({ page }) => {
  await installMockSession(page);
  page.expectedConsoleText.add('Failed to load resource: the server responded with a status of 502 (Bad Gateway)');
  page.expectedConsoleText.add('Failed to load resource: the server responded with a status of 412 (Precondition Failed)');
  const sourceId = 'c2ed2d0d-8276-4fbb-9c4f-39f401a3158a';
  const reservationKeys = [];
  let reserveCalls = 0;
  let completionCalls = 0;
  let uploadPuts = 0;
  await page.route('https://fb18d9f7052afbea5a5e0eae69948af2.r2.cloudflarestorage.com/**', async (route) => {
    uploadPuts += 1;
    return route.fulfill({ status: uploadPuts === 1 ? 200 : 412, body: '' });
  });
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path.endsWith('/music/entitlements')) return route.fulfill({ json: entitlements() });
    if (path.endsWith('/music/sources') && request.method() === 'GET') return route.fulfill({ json: { sources: [] } });
    if (path.endsWith('/music/sources') && request.method() === 'POST') {
      const body = request.postDataJSON();
      if (body.action === 'reserve') {
        reserveCalls += 1;
        reservationKeys.push(body.idempotency_key);
        return route.fulfill({ status: reserveCalls === 1 ? 201 : 200, json: {
          id: sourceId,
          upload_url: 'https://fb18d9f7052afbea5a5e0eae69948af2.r2.cloudflarestorage.com/private-source-replay',
          content_type: 'audio/mpeg',
          headers: { 'If-None-Match': '*' },
          idempotent: reserveCalls > 1,
        } });
      }
      completionCalls += 1;
      if (completionCalls === 1) return route.fulfill({
        status: 502,
        headers: { 'x-music-test-expected-error': '1' },
        json: { error: 'sources_unavailable' },
      });
      return route.fulfill({ json: { source: {
        id: sourceId,
        filename: 'retry.mp3',
        mime_type: 'audio/mpeg',
        size_bytes: 3,
        duration_seconds: 9,
        status: 'ready',
        rights_statement_version: 'music-source-rights-v1',
        preview_url: 'https://downloads.example/retry.mp3',
      }, idempotent: true } });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/create');
  await page.getByRole('button', { name: 'Add owned audio' }).click();
  await page.getByLabel('Choose owned audio').setInputFiles({
    name: 'retry.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3'),
  });
  await page.getByText(/I own or have permission/).click();
  await page.getByRole('button', { name: 'Upload and verify' }).click();
  await expect(page.getByText(/No generation request was made/)).toBeVisible();
  await page.getByRole('button', { name: 'Upload and verify' }).click();
  await expect(page.getByText('retry.mp3', { exact: true })).toBeVisible();
  expect(reserveCalls).toBe(2);
  expect(completionCalls).toBe(2);
  expect(uploadPuts).toBe(2);
  expect(new Set(reservationKeys).size).toBe(1);
});

test('F12-H2 private Library creates a workspace and moves two owned songs atomically', async ({ page }) => {
  await installMockSession(page);
  const defaultId = 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const filmId = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const songA = 'c7ed2d0d-8276-4fbb-9c4f-39f401a3158d';
  const songB = 'd8ed2d0d-8276-4fbb-9c4f-39f401a3158e';
  const sourceId = 'e9ed2d0d-8276-4fbb-9c4f-39f401a3158f';
  let workspaces = [{ id: defaultId, name: 'My Workspace', is_default: true, revision: 0, song_count: 2 }];
  let songs = [
    { id: songA, title: 'Harbour Frame', visibility: 'private', workspace_id: defaultId, workspace_name: 'My Workspace', revision: 0, status: 'ready', lifecycle_status: 'active', audio_url: null, created_at: '2026-11-10T12:00:00Z' },
    { id: songB, title: 'A very long private version title that remains readable on a narrow phone', visibility: 'private', workspace_id: defaultId, workspace_name: 'My Workspace', revision: 0, status: 'ready', lifecycle_status: 'active', audio_url: null, created_at: '2026-11-10T11:00:00Z' },
  ];
  let moveCalls = 0;
  let feedbackCalls = 0;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/music/collaboration') && request.method() === 'GET') return route.fulfill({ json: { profile: null, invitations: [], workspaces: [] } });
    if (path.endsWith('/music/workspaces') && request.method() === 'GET') return route.fulfill({ json: { workspaces } });
    if (path.endsWith('/music/workspaces') && request.method() === 'POST') {
      const body = request.postDataJSON();
      expect(body.name).toBe('Film Cues');
      expect(body.idempotency_key).toMatch(/^workspace\./);
      const workspace = { id: filmId, name: body.name, is_default: false, revision: 0, song_count: 0 };
      workspaces = [...workspaces, workspace];
      return route.fulfill({ status: 201, json: { workspace } });
    }
    if (path.endsWith('/music/songs') && request.method() === 'GET') {
      const collection = new URL(request.url()).searchParams.get('collection') || 'active';
      const lifecycle = collection === 'trash' ? 'trashed' : 'active';
      return route.fulfill({ json: { songs: songs.filter((song) => song.lifecycle_status === lifecycle) } });
    }
    if ([songA, songB].some((id) => path.endsWith(`/music/songs/${id}`)) && request.method() === 'PATCH') {
      const id = path.split('/').at(-1);
      const body = request.postDataJSON();
      const current = songs.find((song) => song.id === id);
      expect(body.revision).toBe(current.revision);
      const lifecycle = body.action === 'trash' ? 'trashed' : 'active';
      songs = songs.map((song) => song.id === id ? { ...song, lifecycle_status: lifecycle, revision: song.revision + 1 } : song);
      const updated = songs.find((song) => song.id === id);
      return route.fulfill({ json: { song: { id, revision: updated.revision, lifecycle_status: lifecycle }, idempotent: false } });
    }
    if (path.endsWith('/music/sources') && request.method() === 'GET') return route.fulfill({ json: { sources: [{
      id: sourceId,
      filename: 'owned-field-recording.wav',
      mime_type: 'audio/wav',
      size_bytes: 1_572_864,
      duration_seconds: 83,
      status: 'ready',
      created_at: '2026-11-10T10:00:00Z',
      rights_statement_version: 'music-source-rights-v1',
      preview_url: 'https://fb18d9f7052afbea5a5e0eae69948af2.r2.cloudflarestorage.com/owned-field-recording.wav',
    }] } });
    if (path.endsWith(`/music/songs/${songA}/feedback`) && request.method() === 'PUT') {
      feedbackCalls += 1;
      const body = request.postDataJSON();
      expect(['like', 'dislike', null]).toContain(body.value);
      songs = songs.map((song) => (song.id === songA ? { ...song, feedback: body.value } : song));
      return route.fulfill({ json: { feedback: body.value } });
    }
    if (path.endsWith('/music/songs/move') && request.method() === 'POST') {
      moveCalls += 1;
      const body = request.postDataJSON();
      expect(body.destination_workspace_id).toBe(filmId);
      expect(body.songs).toEqual([{ id: songB, revision: 2 }, { id: songA, revision: 0 }]);
      const updates = body.songs.map((song) => ({ id: song.id, workspace_id: filmId, revision: song.revision + 1 }));
      songs = songs.map((song) => ({ ...song, workspace_id: filmId, workspace_name: 'Film Cues', revision: song.revision + 1 }));
      workspaces = workspaces.map((workspace) => ({ ...workspace, song_count: workspace.id === filmId ? 2 : 0 }));
      return route.fulfill({ json: { moved: 2, songs: updates } });
    }
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/music/library');
  await expect(page.getByRole('heading', { name: 'Music Library' })).toBeVisible();
  const storageNotice = page.getByRole('region', { name: 'Browser storage notice' });
  await storageNotice.waitFor({ state: 'visible' });
  await storageNotice.locator('[data-storage-dismiss]').click();
  const skipTour = page.getByRole('button', { name: 'Skip tour' });
  if (await skipTour.isVisible()) await skipTour.click();
  await expect(page.getByText('Harbour Frame')).toBeVisible();
  await page.getByRole('button', { name: 'Uploads', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Owned uploads' })).toBeVisible();
  await expect(page.getByText('owned-field-recording.wav', { exact: true })).toBeVisible();
  await expect(page.getByText('1:23 · 1.5 MB · rights verified')).toBeVisible();
  await expect(page.getByText(/Stems are not available yet/)).toBeVisible();
  await expect(page.getByLabel('Play owned upload owned-field-recording.wav')).toHaveAttribute('src', 'https://fb18d9f7052afbea5a5e0eae69948af2.r2.cloudflarestorage.com/owned-field-recording.wav');
  expect(await page.locator('body').textContent()).not.toContain('music-sources/');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  const longTitle = 'A very long private version title that remains readable on a narrow phone';
  const trashButton = page.getByRole('group', { name: `Feedback for ${longTitle}` }).getByRole('button', { name: 'Move to Trash' });
  await trashButton.focus();
  await trashButton.press('Enter');
  await expect(page.getByText(longTitle)).toHaveCount(0);
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(page.getByText(longTitle)).toBeVisible();
  await expect(page.getByText(/Permanent deletion remains unavailable/)).toBeVisible();
  const restoreButton = page.getByRole('button', { name: 'Restore', exact: true });
  await restoreButton.focus();
  await restoreButton.press('Enter');
  await expect(page.getByRole('heading', { name: 'Trash is empty.' })).toBeVisible();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByText(longTitle)).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Search Music Library' });
  await search.fill('missing title');
  await expect(page.getByText('Nothing matches this private view.')).toBeVisible();
  await search.fill('');

  const harbourFeedback = page.getByRole('group', { name: 'Feedback for Harbour Frame' });
  await harbourFeedback.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(harbourFeedback.getByRole('button', { name: 'Like', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(feedbackCalls).toBe(1);
  await page.getByRole('button', { name: 'Liked', exact: true }).click();
  await expect(page.getByText('Harbour Frame')).toBeVisible();
  await expect(page.getByText('A very long private version title that remains readable on a narrow phone')).toHaveCount(0);
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.getByTestId('music-library-items')).toHaveAttribute('data-view', 'grid');
  await page.getByRole('button', { name: 'All', exact: true }).click();

  await page.getByRole('textbox', { name: 'New workspace name' }).fill('Film Cues');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: 'Film Cues · 0' })).toBeVisible();
  await page.getByRole('button', { name: 'All versions' }).click();
  await page.getByRole('checkbox', { name: 'Select all shown' }).check();
  await expect(page.getByText('Move 2 selected versions to')).toBeVisible();
  await page.getByRole('combobox', { name: /move 2 selected versions to/i }).selectOption(filmId);
  await page.getByRole('button', { name: 'Move selected' }).click();
  await expect(page.getByRole('button', { name: 'Film Cues · 2' })).toBeVisible();
  expect(moveCalls).toBe(1);
  await page.getByRole('button', { name: 'Film Cues · 2' }).click();
  await expect(page.getByText('Harbour Frame')).toBeVisible();
  await expect(page.getByText('Film Cues', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
  await page.screenshot({ path: 'replica/suno/clone-screens/S09-server-mobile.png', fullPage: true });

  await page.getByRole('link', { name: 'Workspaces' }).click();
  await expect(page.getByRole('heading', { name: 'Personal workspaces' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Film Cues · 2' })).toBeVisible();
});

test('F13-H1/F14-H1 owners invite by handle and collaborators accept in-app', async ({ page }) => {
  await installMockSession(page);
  const workspaceId = 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const sharedId = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const invitationId = 'c7ed2d0d-8276-4fbb-9c4f-39f401a3158d';
  let collaboration = {
    profile: { handle: 'harbour_owner', display_name: 'Harbour Owner' },
    invitations: [{ id: invitationId, workspace_id: sharedId, workspace_name: 'Night Team', inviter_handle: 'night_owner', inviter_name: 'Night Owner' }],
    workspaces: [{ id: workspaceId, name: 'Film Cues', role: 'owner', is_default: false, member_count: 1, members: [{ handle: 'harbour_owner', display_name: 'Harbour Owner', role: 'owner' }], songs: [] }],
  };
  const mutations = [];
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith('/music/workspaces') && request.method() === 'GET') return route.fulfill({ json: { workspaces: [{ id: workspaceId, name: 'Film Cues', is_default: false, revision: 0, song_count: 0 }] } });
    if (path.endsWith('/music/songs') && request.method() === 'GET') return route.fulfill({ json: { songs: [] } });
    if (path.endsWith('/music/collaboration') && request.method() === 'GET') return route.fulfill({ json: collaboration });
    if (path.endsWith('/music/collaboration') && request.method() === 'POST') {
      const body = request.postDataJSON(); mutations.push(body);
      if (body.action === 'invite') return route.fulfill({ json: { ok: true, invitation_id: 'd8ed2d0d-8276-4fbb-9c4f-39f401a3158e' } });
      if (body.action === 'respond') {
        collaboration = { ...collaboration, invitations: [], workspaces: [...collaboration.workspaces, { id: sharedId, name: 'Night Team', role: 'collaborator', is_default: false, member_count: 2, members: [{ handle: 'night_owner', display_name: 'Night Owner', role: 'owner' }, { handle: 'harbour_owner', display_name: 'Harbour Owner', role: 'collaborator' }], songs: [{ id: 'e9ed2d0d-8276-4fbb-9c4f-39f401a3158f', title: 'Shared Nocturne', audio_url: '/api/v1/jobs/faed2d0d-8276-4fbb-9c4f-39f401a31580/asset' }] }] };
        return route.fulfill({ json: { ok: true, status: 'accepted' } });
      }
    }
    return route.abort('failed');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/music/workspaces');
  await expect(page.getByRole('heading', { name: 'Workspace members' })).toBeVisible();
  await page.getByLabel('Invite handle to Film Cues').fill('guest_one');
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.getByText('Shared Nocturne')).toBeVisible();
  await expect(page.getByText('Your role: collaborator · 2/10 members')).toBeVisible();
  expect(mutations[0]).toMatchObject({ action: 'invite', workspace_id: workspaceId, handle: 'guest_one' });
  expect(mutations[1]).toMatchObject({ action: 'respond', invitation_id: invitationId, decision: 'accept' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F12-E2 a stale atomic move preserves selection and moves no partial subset', async ({ page }) => {
  await installMockSession(page);
  page.expectedConsoleText.add('Failed to load resource: the server responded with a status of 409 (Conflict)');
  const defaultId = 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const filmId = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const songA = 'c7ed2d0d-8276-4fbb-9c4f-39f401a3158d';
  const songB = 'd8ed2d0d-8276-4fbb-9c4f-39f401a3158e';
  const workspaces = [
    { id: defaultId, name: 'My Workspace', is_default: true, revision: 0, song_count: 2 },
    { id: filmId, name: 'Film Cues', is_default: false, revision: 0, song_count: 0 },
  ];
  const songs = [
    { id: songA, title: 'Tab-safe A', visibility: 'private', workspace_id: defaultId, workspace_name: 'My Workspace', revision: 0, status: 'ready', audio_url: null, created_at: '2026-11-10T12:00:00Z' },
    { id: songB, title: 'Tab-safe B', visibility: 'private', workspace_id: defaultId, workspace_name: 'My Workspace', revision: 1, status: 'ready', audio_url: null, created_at: '2026-11-10T11:00:00Z' },
  ];
  let moveCalls = 0;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/music/workspaces') && request.method() === 'GET') return route.fulfill({ json: { workspaces } });
    if (path.endsWith('/music/songs') && request.method() === 'GET') return route.fulfill({ json: { songs } });
    if (path.endsWith('/music/songs/move') && request.method() === 'POST') {
      moveCalls += 1;
      return route.fulfill({ status: 409, json: { error: 'revision_conflict' } });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/library');
  await page.getByRole('checkbox', { name: 'Select all shown' }).check();
  await page.getByRole('combobox', { name: /move 2 selected versions to/i }).selectOption(filmId);
  await page.getByRole('button', { name: 'Move selected' }).click();
  await expect(page.getByText('The Library changed in another tab. Reload before moving these songs.')).toBeVisible();
  await expect(page.getByText('Move 2 selected versions to')).toBeVisible();
  await expect(page.locator('article').filter({ hasText: 'Tab-safe A' }).getByText('My Workspace', { exact: true })).toBeVisible();
  expect(moveCalls).toBe(1);
});

test('F12-E3 a lost workspace-create acknowledgement retries the same key', async ({ page }) => {
  await installMockSession(page);
  const defaultId = 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const filmId = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const bodies = [];
  const workspaces = [{ id: defaultId, name: 'My Workspace', is_default: true, revision: 0, song_count: 0 }];
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/music/workspaces') && request.method() === 'GET') return route.fulfill({ json: { workspaces } });
    if (path.endsWith('/music/songs') && request.method() === 'GET') return route.fulfill({ json: { songs: [] } });
    if (path.endsWith('/music/workspaces') && request.method() === 'POST') {
      bodies.push(request.postDataJSON());
      if (bodies.length === 1) {
        page.expectedRequestFailures.add(request.url());
        page.expectedConsoleErrorUrls.add(request.url());
        return route.abort('failed');
      }
      return route.fulfill({ status: 200, json: { workspace: {
        id: filmId, name: 'Film Cues', is_default: false, revision: 0, song_count: 0,
      } } });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/library');
  await expect(page.getByRole('button', { name: 'My Workspace · 0' })).toBeVisible();
  const name = page.getByRole('textbox', { name: 'New workspace name' });
  await name.fill('Film Cues');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByText('The Library could not reach the server. Your selection remains here.')).toBeVisible();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: 'Film Cues · 0' })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0].idempotency_key).toMatch(/^workspace\./);
  expect(bodies[1].idempotency_key).toBe(bodies[0].idempotency_key);
});

test('F12-E4 a lost atomic-move acknowledgement retries one durable move key', async ({ page }) => {
  await installMockSession(page);
  const defaultId = 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const filmId = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const songId = 'c7ed2d0d-8276-4fbb-9c4f-39f401a3158d';
  const workspaces = [
    { id: defaultId, name: 'My Workspace', is_default: true, revision: 0, song_count: 1 },
    { id: filmId, name: 'Film Cues', is_default: false, revision: 0, song_count: 0 },
  ];
  const songs = [{ id: songId, title: 'Retry-safe move', visibility: 'private', workspace_id: defaultId, workspace_name: 'My Workspace', revision: 0, status: 'ready', audio_url: null, created_at: '2026-11-10T12:00:00Z' }];
  const bodies = [];
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/music/workspaces') && request.method() === 'GET') return route.fulfill({ json: { workspaces } });
    if (path.endsWith('/music/songs') && request.method() === 'GET') return route.fulfill({ json: { songs } });
    if (path.endsWith('/music/songs/move') && request.method() === 'POST') {
      bodies.push(request.postDataJSON());
      if (bodies.length === 1) {
        page.expectedRequestFailures.add(request.url());
        page.expectedConsoleErrorUrls.add(request.url());
        return route.abort('failed');
      }
      return route.fulfill({ status: 200, json: { moved: 1, songs: [{ id: songId, workspace_id: filmId, revision: 1 }] } });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/library');
  await page.getByRole('checkbox', { name: 'Select Retry-safe move' }).check();
  const destination = page.getByRole('combobox', { name: /move 1 selected version to/i });
  await destination.selectOption(filmId);
  await page.getByRole('button', { name: 'Move selected' }).click();
  await expect(page.getByText('The Library could not reach the server. Your selection remains here.')).toBeVisible();
  await page.getByRole('button', { name: 'Move selected' }).click();
  await expect(page.getByRole('button', { name: 'Film Cues · 1' })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0].idempotency_key).toMatch(/^move\./);
  expect(bodies[1].idempotency_key).toBe(bodies[0].idempotency_key);
});

test('F12-E5 rapid workspace submission is synchronously deduplicated', async ({ page }) => {
  await installMockSession(page);
  const defaultId = 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const filmId = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const workspaces = [{ id: defaultId, name: 'My Workspace', is_default: true, revision: 0, song_count: 0 }];
  let creates = 0;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/music/workspaces') && request.method() === 'GET') return route.fulfill({ json: { workspaces } });
    if (path.endsWith('/music/songs') && request.method() === 'GET') return route.fulfill({ json: { songs: [] } });
    if (path.endsWith('/music/workspaces') && request.method() === 'POST') {
      creates += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return route.fulfill({ status: 201, json: { workspace: {
        id: filmId, name: 'Rapid-safe', is_default: false, revision: 0, song_count: 0,
      } } });
    }
    return route.abort('failed');
  });

  await page.goto('/app/music/library');
  await expect(page.getByRole('button', { name: 'My Workspace · 0' })).toBeVisible();
  const name = page.getByRole('textbox', { name: 'New workspace name' });
  await name.fill('Rapid-safe');
  await name.evaluate((element) => {
    element.form.requestSubmit();
    element.form.requestSubmit();
  });
  await expect(page.getByRole('button', { name: 'Rapid-safe · 0' })).toBeVisible();
  expect(creates).toBe(1);
});

test('F12-N2 duplicate names and disappeared records fail closed without local mutation', async ({ page }) => {
  await installMockSession(page);
  page.expectedConsoleText.add('Failed to load resource: the server responded with a status of 409 (Conflict)');
  page.expectedConsoleText.add('Failed to load resource: the server responded with a status of 404 (Not Found)');
  const defaultId = 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const filmId = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const songId = 'c7ed2d0d-8276-4fbb-9c4f-39f401a3158d';
  const workspaces = [
    { id: defaultId, name: 'My Workspace', is_default: true, revision: 0, song_count: 1 },
    { id: filmId, name: 'Film Cues', is_default: false, revision: 0, song_count: 0 },
  ];
  const songs = [{ id: songId, title: 'Owner-only song', visibility: 'private', workspace_id: defaultId, workspace_name: 'My Workspace', revision: 0, status: 'ready', audio_url: null, created_at: '2026-11-10T12:00:00Z' }];
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/music/workspaces') && request.method() === 'GET') return route.fulfill({ json: { workspaces } });
    if (path.endsWith('/music/songs') && request.method() === 'GET') return route.fulfill({ json: { songs } });
    if (path.endsWith('/music/workspaces') && request.method() === 'POST') return route.fulfill({ status: 409, json: { error: 'name_taken' } });
    if (path.endsWith('/music/songs/move') && request.method() === 'POST') return route.fulfill({ status: 404, json: { error: 'not_found' } });
    return route.abort('failed');
  });

  await page.goto('/app/music/library');
  await expect(page.getByRole('button', { name: 'Film Cues · 0' })).toBeVisible();
  const name = page.getByRole('textbox', { name: 'New workspace name' });
  await name.fill('Film Cues');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByText('A workspace with that name already exists.')).toBeVisible();
  await expect(name).toHaveValue('Film Cues');

  await page.getByRole('checkbox', { name: 'Select Owner-only song' }).check();
  await page.getByRole('combobox', { name: /move 1 selected version to/i }).selectOption(filmId);
  await page.getByRole('button', { name: 'Move selected' }).click();
  await expect(page.getByText('One selected song or workspace is no longer available. Reload the Library.')).toBeVisible();
  await expect(page.getByText('Move 1 selected version to')).toBeVisible();
  await expect(page.locator('article').filter({ hasText: 'Owner-only song' }).getByText('My Workspace', { exact: true })).toBeVisible();
});

test('F06-H1 private song actions expose real lineage and organization only', async ({ page }) => {
  await installMockSession(page);
  const songId = 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const originalVersionId = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const currentVersionId = 'c7ed2d0d-8276-4fbb-9c4f-39f401a3158d';
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith(`/music/songs/${songId}`) && request.method() === 'GET') {
      return route.fulfill({ json: {
        id: songId,
        title: 'Night harbour lineage',
        visibility: 'private',
        created_at: '2026-11-10T10:00:00Z',
        version_id: currentVersionId,
        audio_url: 'data:audio/wav;base64,UklGRg==',
        actions: ['view_lineage', 'organize'],
        current_version: { id: currentVersionId, version_number: 2, operation: 'reuse', parent_version_id: originalVersionId, created_at: '2026-11-10T11:00:00Z' },
        versions: [
          { id: currentVersionId, version_number: 2, operation: 'reuse', parent_version_id: originalVersionId, is_current: true, created_at: '2026-11-10T11:00:00Z' },
          { id: originalVersionId, version_number: 1, operation: 'generation', parent_version_id: null, is_current: false, created_at: '2026-11-10T10:00:00Z' },
        ],
        lineage: [{ id: 'd8ed2d0d-8276-4fbb-9c4f-39f401a3158e', output_version_id: currentVersionId, source_version_id: originalVersionId, source_song_id: songId, source_title: 'Night harbour lineage', source_version_number: 1, relation: 'reuse_source', ordinal: 1 }],
      } });
    }
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/music/songs/${songId}`);
  await expect(page.getByRole('heading', { name: 'Night harbour lineage' })).toBeVisible();
  const actions = page.getByRole('button', { name: 'More actions for Night harbour lineage' });
  await actions.click();
  await expect(page.getByRole('menuitem', { name: 'View version lineage' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Organize in Music Library' })).toHaveAttribute('href', '/app/music/library');
  await expect(page.getByRole('menuitem', { name: /cover|extend|share|download/i })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'View version lineage' }).click();
  const lineage = page.getByRole('region', { name: 'Version lineage' });
  await expect(lineage).toBeFocused();
  await expect(lineage.getByText('Version 2', { exact: true })).toBeVisible();
  await expect(lineage.getByText('Version 1', { exact: true })).toBeVisible();
  await expect(lineage.getByText(/Night harbour lineage · version 1/)).toBeVisible();

  await actions.click();
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await actions.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.screenshot({ path: 'replica/suno/clone-screens/S11-server-mobile.png' });
});

test('F06-E2 action menu arrows, outside click and long hash-linked history remain usable', async ({ page }) => {
  await installMockSession(page);
  const songId = 'e9ed2d0d-8276-4fbb-9c4f-39f401a3158f';
  const versions = Array.from({ length: 30 }, (_, index) => ({
    id: `${(index + 1).toString(16).padStart(8, '0')}-8276-4fbb-9c4f-39f401a3158c`,
    version_number: index + 1,
    operation: index === 0 ? 'generation' : 'reuse',
    parent_version_id: index === 0 ? null : `${index.toString(16).padStart(8, '0')}-8276-4fbb-9c4f-39f401a3158c`,
    is_current: index === 29,
    created_at: new Date(Date.UTC(2026, 10, 10, 10, index)).toISOString(),
  })).reverse();
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith(`/music/songs/${songId}`) && request.method() === 'GET') {
      return route.fulfill({ json: {
        id: songId,
        title: 'Thirty recoverable branches ✨',
        visibility: 'private',
        created_at: '2026-11-10T10:00:00Z',
        version_id: versions[0].id,
        audio_url: 'data:audio/wav;base64,UklGRg==',
        actions: ['view_lineage', 'organize'],
        current_version: versions[0],
        versions,
        lineage: [],
      } });
    }
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/music/songs/${songId}`);
  const trigger = page.getByRole('button', { name: 'More actions for Thirty recoverable branches ✨' });
  await trigger.click();
  const viewLineage = page.getByRole('menuitem', { name: 'View version lineage' });
  const organize = page.getByRole('menuitem', { name: 'Organize in Music Library' });
  await expect(viewLineage).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(organize).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(viewLineage).toBeFocused();
  await page.mouse.click(5, 300);
  await expect(page.getByRole('menu')).toHaveCount(0);

  await page.goto(`/app/music/songs/${songId}#lineage`);
  const history = page.getByRole('region', { name: 'Version lineage' });
  await expect(history).toBeFocused();
  await expect(history.getByText('Version 30', { exact: true })).toBeVisible();
  await expect(history.getByText('Version 1', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F16-H1/F19-H1 private links revoke and WAV allowance is quoted before export', async ({ page }) => {
  await installMockSession(page);
  const songId = 'f1ed2d0d-8276-4fbb-9c4f-39f401a3158a';
  const versionId = 'f2ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const linkId = 'f3ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const quoteId = 'f4ed2d0d-8276-4fbb-9c4f-39f401a3158d';
  const exportId = 'f5ed2d0d-8276-4fbb-9c4f-39f401a3158e';
  const seen = { share: null, revoke: null, quote: null, start: null };
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith(`/music/songs/${songId}`) && request.method() === 'GET') return route.fulfill({ json: {
      id: songId, title: 'Private midnight master', visibility: 'private',
      created_at: '2026-11-10T10:00:00Z', version_id: versionId,
      audio_url: 'data:audio/mpeg;base64,SUQz',
      actions: ['view_lineage', 'share_link', 'download_mp3', 'organize'],
      current_version: { id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, created_at: '2026-11-10T10:00:00Z' },
      versions: [{ id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, is_current: true, created_at: '2026-11-10T10:00:00Z' }], lineage: [],
    } });
    if (path.endsWith(`/music/songs/${songId}/share-links`) && request.method() === 'GET') return route.fulfill({ json: { links: [] } });
    if (path.endsWith(`/music/songs/${songId}/share-links`) && request.method() === 'POST') {
      seen.share = request.postDataJSON();
      return route.fulfill({ status: 201, json: { link: { id: linkId, version_id: versionId, url: `/listen/${seen.share.token}`, revoked_at: null, created_at: '2026-11-10T12:00:00Z' } } });
    }
    if (path.endsWith(`/music/share-links/${linkId}`) && request.method() === 'DELETE') {
      seen.revoke = request.postDataJSON();
      return route.fulfill({ json: { link: { id: linkId, revoked_at: '2026-11-10T12:01:00Z' }, idempotent: false } });
    }
    if (path.endsWith(`/music/songs/${songId}/export-quotes`) && request.method() === 'POST') {
      seen.quote = request.postDataJSON();
      return route.fulfill({ status: 201, json: { quote: { id: quoteId, format: 'wav', consumes_allowance: true, allowance: 20, used: 4, remaining_after: 15, expires_at: '2026-11-10T12:05:00Z' } } });
    }
    if (path.endsWith(`/music/songs/${songId}/exports`) && request.method() === 'POST') {
      seen.start = request.postDataJSON();
      return route.fulfill({ status: 201, json: { export: { id: exportId, state: 'ready' }, allowance: { total: 20, used: 5, remaining: 15 }, idempotent: false } });
    }
    if (path.endsWith(`/music/exports/${exportId}`) && request.method() === 'GET') return route.fulfill({ json: { export: { id: exportId, state: 'ready', url: 'https://downloads.example/private.wav', format: 'wav', mime_type: 'audio/wav', expires_in: 300 } } });
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/music/songs/${songId}`);
  const actions = page.getByRole('button', { name: 'More actions for Private midnight master' });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Create private share link' }).click();
  const shareDialog = page.getByRole('dialog', { name: /Share “Private midnight master” privately/ });
  await expect(shareDialog).toBeVisible();
  await expect(shareDialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(shareDialog.getByRole('button', { name: 'Create private link' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(shareDialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await expect(page.getByText(/not indexed or published/i)).toBeVisible();
  await page.getByRole('button', { name: 'Create private link' }).click();
  await expect(page.getByRole('textbox', { name: 'Private share link' })).toHaveValue(/\/listen\/[A-Za-z0-9_-]{43}$/);
  expect(seen.share.version_id).toBe(versionId);
  expect(seen.share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(seen.share.idempotency_key).toMatch(/^share\./);
  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Private link revoked.')).toBeVisible();
  expect(seen.revoke.idempotency_key).toMatch(/^revoke\./);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(actions).toBeFocused();

  await actions.click();
  await page.getByRole('menuitem', { name: 'Download audio' }).click();
  await page.getByRole('combobox', { name: 'Stored audio format' }).selectOption('wav');
  await page.getByRole('button', { name: 'Review WAV allowance' }).click();
  await expect(page.getByText('Uses 1 download')).toBeVisible();
  await expect(page.getByText('15 remaining')).toBeVisible();
  expect(seen.start).toBe(null);
  await page.getByRole('button', { name: 'Prepare WAV download' }).click();
  await expect(page.getByRole('link', { name: 'Download WAV now' })).toHaveAttribute('href', 'https://downloads.example/private.wav');
  expect(seen.quote).toEqual({ version_id: versionId, format: 'wav' });
  expect(seen.start.quote_id).toBe(quoteId);
  expect(seen.start.idempotency_key).toMatch(/^export\./);
  await expect(page.getByText(/15 downloads remain/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
  await page.screenshot({ path: 'replica/suno/clone-screens/S12-server-mobile.png' });
});

test('F16-H3 publication creates a reversible profile listing with honest rights status', async ({ page }) => {
  await installMockSession(page);
  const songId = 'e1ed2d0d-8276-4fbb-9c4f-39f401a3158a';
  const versionId = 'e2ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const slug = 'abcdef0123456789abcdef01';
  let published = false;
  let publishBody = null;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith(`/music/songs/${songId}`) && request.method() === 'GET') return route.fulfill({ json: {
      id: songId, title: 'Rights in daylight', visibility: 'private', created_at: '2026-11-10T10:00:00Z',
      version_id: versionId, audio_url: 'data:audio/mpeg;base64,SUQz', actions: ['view_lineage', 'publish', 'organize'],
      current_version: { id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, created_at: '2026-11-10T10:00:00Z' },
      versions: [{ id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, is_current: true, created_at: '2026-11-10T10:00:00Z' }], lineage: [],
    } });
    if (path.endsWith(`/music/songs/${songId}/publication`) && request.method() === 'GET') return route.fulfill({ json: { publication: published ? {
      slug, status: 'published', handle: 'night_signal', display_name: 'Night Signal', allow_comments: false,
      allow_remixes: true, commercial_status: 'plan_eligible_terms_apply', url: `/music/tracks/${slug}`, profile_url: '/music/creators/night_signal',
    } : null } });
    if (path.endsWith(`/music/songs/${songId}/publication`) && request.method() === 'POST') {
      publishBody = request.postDataJSON(); published = true;
      return route.fulfill({ status: 201, json: { publication: { slug, status: 'published', handle: 'night_signal', display_name: 'Night Signal', allow_comments: false, allow_remixes: true, commercial_status: 'plan_eligible_terms_apply', url: `/music/tracks/${slug}`, profile_url: '/music/creators/night_signal' } } });
    }
    if (path.endsWith(`/music/songs/${songId}/publication`) && request.method() === 'DELETE') { published = false; return route.fulfill({ json: { ok: true } }); }
    if (path.endsWith(`/music/public/${slug}/asset`) && request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from('ID3') });
    if (path.endsWith(`/music/public/${slug}`) && request.method() === 'GET') return published
      ? route.fulfill({ json: { track: { title: 'Rights in daylight', version_number: 1, published_at: '2026-11-10T12:00:00Z', allow_comments: false, allow_remixes: true, commercial_status: 'plan_eligible_terms_apply', handle: 'night_signal', display_name: 'Night Signal', audio_url: `/api/v1/music/public/${slug}/asset` } } })
      : route.fulfill({ status: 404, json: { error: 'not_found' } });
    if (path.endsWith('/music/profiles/night_signal') && request.method() === 'GET') return route.fulfill({ json: { profile: { handle: 'night_signal', display_name: 'Night Signal' }, tracks: published ? [{ slug, title: 'Rights in daylight', published_at: '2026-11-10T12:00:00Z', commercial_status: 'plan_eligible_terms_apply' }] : [] } });
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/music/songs/${songId}`);
  const actions = page.getByRole('button', { name: 'More actions for Rights in daylight' });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Publish to creator profile' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish “Rights in daylight”' });
  await dialog.getByRole('textbox', { name: 'Creator handle' }).fill('night_signal');
  await dialog.getByRole('textbox', { name: 'Creator display name' }).fill('Night Signal');
  await dialog.getByText(/I have permission to publish/).click();
  await dialog.getByText('Allow remixes').click();
  await dialog.getByRole('button', { name: 'Publish current immutable version' }).click();
  await expect(dialog.getByRole('link', { name: 'Open public track' })).toHaveAttribute('href', `/music/tracks/${slug}`);
  await expect(dialog.getByText(/Plan eligible · applicable terms/)).toBeVisible();
  expect(publishBody).toEqual({ version_id: versionId, handle: 'night_signal', display_name: 'Night Signal', allow_comments: false, allow_remixes: true, rights_confirmed: true, idempotency_key: expect.stringMatching(/^publish\./) });
  await page.goto(`/music/tracks/${slug}`);
  await expect(page.getByRole('heading', { name: 'Rights in daylight' })).toBeVisible();
  await expect(page.getByText('Comments disabled')).toBeVisible();
  await expect(page.getByText('Remixes allowed')).toBeVisible();
  await page.goto('/music/creators/night_signal');
  await expect(page.getByRole('heading', { name: 'Night Signal' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Rights in daylight/ })).toBeVisible();
  await page.goto(`/app/music/songs/${songId}`);
  await actions.click();
  await page.getByRole('menuitem', { name: 'Publish to creator profile' }).click();
  await page.getByRole('button', { name: 'Unpublish' }).click();
  await expect(page.getByText(/public track and profile listing now fail closed/i)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F08-H1 crop saves a new canonical WAV version and preserves the original', async ({ page }) => {
  await installMockSession(page);
  const songId='d1ed2d0d-8276-4fbb-9c4f-39f401a3158a'; const first='d2ed2d0d-8276-4fbb-9c4f-39f401a3158b'; const second='d3ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  let cropped=false; let body=null;
  await page.route('**/test-music-crop.wav',route=>route.fulfill({contentType:'audio/wav',body:wav()}));
  await page.route('**/api/v1/music/**',async route=>{
    const request=route.request(); const path=new URL(request.url()).pathname;
    if(path.endsWith(`/music/songs/${songId}`)&&request.method()==='GET')return route.fulfill({json:{id:songId,title:'Keep the original',visibility:'private',created_at:'2026-11-10T10:00:00Z',version_id:cropped?second:first,audio_url:'/test-music-crop.wav',actions:['view_lineage','crop','organize'],provenance:cropped?{crop:{start_seconds:0.5,end_seconds:1.5,source_duration:2,output_duration:1},render_state:'canonical'}:{},current_version:{id:cropped?second:first,version_number:cropped?2:1,operation:cropped?'crop':'generation',parent_version_id:cropped?first:null,created_at:'2026-11-10T10:00:00Z'},versions:cropped?[{id:second,version_number:2,operation:'crop',parent_version_id:first,is_current:true,created_at:'2026-11-10T10:01:00Z'},{id:first,version_number:1,operation:'generation',parent_version_id:null,is_current:false,created_at:'2026-11-10T10:00:00Z'}]:[{id:first,version_number:1,operation:'generation',parent_version_id:null,is_current:true,created_at:'2026-11-10T10:00:00Z'}],lineage:cropped?[{id:'d4ed2d0d-8276-4fbb-9c4f-39f401a3158d',output_version_id:second,source_version_id:first,source_title:'Keep the original',source_version_number:1,relation:'edit_source',ordinal:1}]:[]}});
    if(path.endsWith(`/music/songs/${songId}/crop`)&&request.method()==='POST'){body=request.postDataJSON();cropped=true;return route.fulfill({status:201,json:{version_id:second,version_number:2,render_state:'canonical',format:'wav',idempotent:false}});}
    return route.abort('failed');
  });
  await page.setViewportSize({width:390,height:844}); await page.goto(`/app/music/songs/${songId}`);
  await page.getByRole('button',{name:'More actions for Keep the original'}).click(); await page.getByRole('menuitem',{name:'Crop beginning or end'}).click();
  const dialog=page.getByRole('dialog',{name:'Crop “Keep the original”'}); await expect(dialog.getByRole('spinbutton',{name:'Crop end seconds'})).toHaveValue('2');
  await dialog.getByRole('spinbutton',{name:'Crop start seconds'}).fill('0.5'); await dialog.getByRole('spinbutton',{name:'Crop end seconds'}).fill('1.5');
  await dialog.getByRole('button',{name:'Save as new cropped version'}).click();
  await expect(page.getByText('Version 2',{exact:true})).toBeVisible(); await expect(page.getByText('Version 1',{exact:true})).toBeVisible(); await expect(page.getByText(/Rendered WAV master from 0.5s–1.5s/)).toBeVisible();
  await expect(page.getByRole('article').locator('audio')).not.toHaveAttribute('src', /#t=/);
  expect(body).toEqual({version_id:first,start_seconds:0.5,end_seconds:1.5,idempotency_key:expect.stringMatching(/^crop\./)});
  const accessibility=await new AxeBuilder({page}).include('#main').analyze(); expect(accessibility.violations,accessibility.violations.map(item=>`${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F08-H2 fade, speed, two-section reorder and deterministic remaster create exportable WAV children', async ({ page }) => {
  await installMockSession(page);
  const songId='f1ed2d0d-8276-4fbb-9c4f-39f401a3158a';
  const versions=['f2ed2d0d-8276-4fbb-9c4f-39f401a3158b','f3ed2d0d-8276-4fbb-9c4f-39f401a3158c','f4ed2d0d-8276-4fbb-9c4f-39f401a3158d','f5ed2d0d-8276-4fbb-9c4f-39f401a3158e','f6ed2d0d-8276-4fbb-9c4f-39f401a3158f'];
  let current=0; const bodies=[];
  await page.route('**/test-music-render.wav',route=>route.fulfill({contentType:'audio/wav',body:wav(4)}));
  await page.route('**/api/v1/music/**',async route=>{
    const request=route.request(); const path=new URL(request.url()).pathname;
    if(path.endsWith(`/music/songs/${songId}`)&&request.method()==='GET'){
      const operations=['generation','fade','speed','reorder','remaster']; const operation=operations[current];
      const provenance=current===1?{fade:{fade_in_seconds:1,fade_out_seconds:1,source_duration:4,output_duration:4},render_state:'canonical'}:current===2?{speed:{speed_ratio:1.5,source_duration:4,output_duration:2.6667},render_state:'canonical'}:current===3?{reorder:{split_seconds:1.5,order:[2,1],source_duration:4,output_duration:4},render_state:'canonical'}:current===4?{remaster:{target_peak_dbfs:-2,source_duration:4,output_duration:4},render_state:'canonical'}:{};
      return route.fulfill({json:{id:songId,title:'Elastic daylight',visibility:'private',created_at:'2026-11-10T10:00:00Z',version_id:versions[current],audio_url:'/test-music-render.wav',actions:['view_lineage','render','organize'],provenance,current_version:{id:versions[current],version_number:current+1,operation,parent_version_id:current?versions[current-1]:null,created_at:'2026-11-10T10:00:00Z'},versions:Array.from({length:current+1},(_,index)=>({id:versions[current-index],version_number:current-index+1,operation:operations[current-index],parent_version_id:current-index?versions[current-index-1]:null,is_current:index===0,created_at:'2026-11-10T10:00:00Z'})),lineage:current?Array.from({length:current},(_,index)=>({id:`e${index}ed2d0d-8276-4fbb-9c4f-39f401a3158${index}`,output_version_id:versions[index+1],source_version_id:versions[index],source_title:'Elastic daylight',source_version_number:index+1,relation:'edit_source',ordinal:1})):[]}});
    }
    if(path.endsWith(`/music/songs/${songId}/render`)&&request.method()==='POST'){
      bodies.push(request.postDataJSON()); current+=1;
      return route.fulfill({status:201,json:{version_id:versions[current],version_number:current+1,operation:bodies.at(-1).operation,render_state:'canonical',format:'wav',idempotent:false}});
    }
    return route.abort('failed');
  });
  await page.setViewportSize({width:390,height:844}); await page.goto(`/app/music/songs/${songId}`);
  await page.getByRole('button',{name:'More actions for Elastic daylight'}).click();
  await page.getByRole('menuitem',{name:'Fade, speed, reorder, or remaster'}).click();
  let dialog=page.getByRole('dialog',{name:'Edit “Elastic daylight”'});
  await expect(dialog.getByRole('spinbutton',{name:'Fade in seconds'})).toHaveValue('1');
  await dialog.getByRole('button',{name:'Save faded WAV as new version'}).click();
  await expect(page.getByText(/1.0s fade in · 1.0s fade out/)).toBeVisible();
  await page.getByRole('button',{name:'More actions for Elastic daylight'}).click();
  await page.getByRole('menuitem',{name:'Fade, speed, reorder, or remaster'}).click();
  dialog=page.getByRole('dialog',{name:'Edit “Elastic daylight”'});
  await dialog.getByRole('tab',{name:'Speed'}).click();
  await dialog.getByRole('slider',{name:'Speed ratio'}).fill('1.5');
  await dialog.getByRole('button',{name:'Save speed-adjusted WAV as new version'}).click();
  await expect(page.getByText(/1.50× speed and linked pitch/)).toBeVisible();
  await page.getByRole('button',{name:'More actions for Elastic daylight'}).click();
  await page.getByRole('menuitem',{name:'Fade, speed, reorder, or remaster'}).click();
  dialog=page.getByRole('dialog',{name:'Edit “Elastic daylight”'});
  await dialog.getByRole('tab',{name:'Reorder'}).click();
  await dialog.getByRole('slider',{name:'Section split time'}).fill('1.5');
  await dialog.getByRole('button',{name:'Save reordered WAV as new version'}).click();
  await expect(page.getByText(/split at 1.5s and moved section 2 before section 1/)).toBeVisible();
  await page.getByRole('button',{name:'More actions for Elastic daylight'}).click();
  await page.getByRole('menuitem',{name:'Fade, speed, reorder, or remaster'}).click();
  dialog=page.getByRole('dialog',{name:'Edit “Elastic daylight”'});
  await dialog.getByRole('tab',{name:'Remaster'}).click();
  await expect(dialog.getByRole('combobox',{name:'Remaster character'})).toHaveValue('-2');
  await expect(dialog.getByText(/not AI mastering, compression, EQ, or loudness matching/)).toBeVisible();
  await dialog.getByRole('button',{name:'Save remastered WAV as new version'}).click();
  await expect(page.getByText(/DC-corrected with linked gain to -2 dBFS peak/)).toBeVisible();
  await expect(page.getByText('Version 5',{exact:true})).toBeVisible();
  await expect(page.getByText('Version 1',{exact:true})).toBeVisible();
  expect(bodies).toEqual([
    {operation:'fade',version_id:versions[0],fade_in_seconds:1,fade_out_seconds:1,idempotency_key:expect.stringMatching(/^render\./)},
    {operation:'speed',version_id:versions[1],speed_ratio:1.5,idempotency_key:expect.stringMatching(/^render\./)},
    {operation:'reorder',version_id:versions[2],split_seconds:1.5,order:[2,1],idempotency_key:expect.stringMatching(/^render\./)},
    {operation:'remaster',version_id:versions[3],target_peak_dbfs:-2,idempotency_key:expect.stringMatching(/^render\./)},
  ]);
  const accessibility=await new AxeBuilder({page}).include('#main').analyze();
  expect(accessibility.violations,accessibility.violations.map(item=>`${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F15-H1 playlist creation, ordered membership, search, shuffle and pin remain private',async({page})=>{
 await installMockSession(page);const pid='c1ed2d0d-8276-4fbb-9c4f-39f401a3158a',a='c2ed2d0d-8276-4fbb-9c4f-39f401a3158b',b='c3ed2d0d-8276-4fbb-9c4f-39f401a3158c';
 const songs=[{id:a,title:'Dawn Index',audio_url:'data:audio/wav;base64,UklGRg=='},{id:b,title:'Night Ledger',audio_url:'data:audio/wav;base64,UklGRg=='}];let playlist=null;const patches=[];let initialLoads=0;
 await page.route('**/api/v1/music/**',async route=>{const r=route.request(),path=new URL(r.url()).pathname;if(path.endsWith('/music/songs')&&r.method()==='GET'){initialLoads+=1;return route.fulfill({json:{songs}});}if(path.endsWith('/music/playlists')&&r.method()==='GET'){initialLoads+=1;return route.fulfill({json:{playlists:playlist?[playlist]:[]}});}if(path.endsWith('/music/playlists')&&r.method()==='POST'){const body=r.postDataJSON();playlist={id:pid,title:body.title,pinned:false,revision:0,songs:[]};return route.fulfill({status:201,json:{playlist}});}if(path.endsWith(`/music/playlists/${pid}`)&&r.method()==='PATCH'){const body=r.postDataJSON();patches.push(body);if(body.expected_revision!==playlist.revision)return route.fulfill({status:409,json:{error:'revision_conflict',revision:playlist.revision}});playlist={...playlist,revision:playlist.revision+1,...(body.action==='pin'?{pinned:body.pinned}:{songs:body.song_ids.map((id,index)=>({...songs.find(s=>s.id===id),position:index+1}))})};return route.fulfill({json:{revision:playlist.revision}});}return route.abort('failed');});
 await page.setViewportSize({width:390,height:844});await page.goto('/app/music/playlists');await expect.poll(()=>initialLoads).toBeGreaterThanOrEqual(2);await page.getByRole('textbox',{name:'New playlist title'}).fill('Film cues');await page.getByRole('button',{name:'Create playlist'}).click();await expect(page.getByRole('heading',{name:'Film cues'})).toBeVisible();
 await page.getByText('Dawn Index',{exact:true}).click();await expect(page.getByRole('list').getByText('Dawn Index')).toBeVisible();await page.getByText('Night Ledger',{exact:true}).first().click();await expect(page.getByRole('list').getByText('Night Ledger')).toBeVisible();
 await page.getByRole('searchbox',{name:'Search this playlist'}).fill('Night');await expect(page.getByRole('list').getByText('Dawn Index')).toHaveCount(0);await expect(page.getByRole('list').getByText('Night Ledger')).toBeVisible();await page.getByRole('searchbox',{name:'Search this playlist'}).fill('');await page.getByRole('button',{name:'All playlists'}).click();await expect(page.getByRole('searchbox',{name:'Search all playlists'})).toBeVisible();await expect(page.getByText('Film cues',{exact:true}).last()).toBeVisible();await page.getByRole('button',{name:'This playlist'}).click();await page.getByRole('button',{name:'Shuffle order'}).click();await page.getByRole('button',{name:'Pin playlist'}).click();await expect(page.getByRole('button',{name:/★ Film cues/})).toBeVisible();expect(patches.filter(x=>x.action==='replace')).toHaveLength(2);expect(patches.at(-1).action).toBe('pin');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);const axe=await new AxeBuilder({page}).include('#main').analyze();expect(axe.violations,axe.violations.map(x=>`${x.id}: ${x.help}`).join('\n')).toEqual([]);
});

test('F19-E1 retry after an ambiguous signed-URL failure reuses one allowance claim', async ({ page }) => {
  await installMockSession(page);
  const songId = 'a1ed2d0d-8276-4fbb-9c4f-39f401a3158a';
  const versionId = 'a2ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const quoteId = 'a3ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const exportId = 'a4ed2d0d-8276-4fbb-9c4f-39f401a3158d';
  const startBodies = [];
  let quoteCalls = 0;
  let exportReads = 0;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith(`/music/songs/${songId}`) && request.method() === 'GET') return route.fulfill({ json: {
      id: songId, title: 'Recoverable allowance master', visibility: 'private',
      created_at: '2026-11-10T10:00:00Z', version_id: versionId,
      audio_url: 'data:audio/mpeg;base64,SUQz',
      actions: ['download_mp3'],
      current_version: { id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, created_at: '2026-11-10T10:00:00Z' },
      versions: [{ id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, is_current: true, created_at: '2026-11-10T10:00:00Z' }], lineage: [],
    } });
    if (path.endsWith(`/music/songs/${songId}/export-quotes`) && request.method() === 'POST') {
      quoteCalls += 1;
      return route.fulfill({ status: 201, json: { quote: { id: quoteId, format: 'mp3', consumes_allowance: true, allowance: 20, used: 4, remaining_after: 15, expires_at: '2026-11-10T12:05:00Z' } } });
    }
    if (path.endsWith(`/music/songs/${songId}/exports`) && request.method() === 'POST') {
      startBodies.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: { export: { id: exportId, state: 'ready' }, allowance: { total: 20, used: 5, remaining: 15 }, idempotent: startBodies.length > 1 } });
    }
    if (path.endsWith(`/music/exports/${exportId}`) && request.method() === 'GET') {
      exportReads += 1;
      if (exportReads === 1) {
        page.expectedConsoleErrorUrls.add(request.url());
        return route.fulfill({ status: 502, headers: { 'x-music-test-expected-error': '1' }, json: { error: 'temporarily_unavailable' } });
      }
      return route.fulfill({ json: { export: { id: exportId, state: 'ready', url: 'https://downloads.example/recovered.mp3', format: 'mp3', mime_type: 'audio/mpeg', expires_in: 300 } } });
    }
    return route.abort('failed');
  });

  await page.goto(`/app/music/songs/${songId}`);
  await page.getByRole('button', { name: 'More actions for Recoverable allowance master' }).click();
  await page.getByRole('menuitem', { name: 'Download audio' }).click();
  await page.getByRole('button', { name: 'Review MP3 allowance' }).click();
  const prepare = page.getByRole('button', { name: 'Prepare MP3 download' });
  await prepare.click();
  await expect(page.getByText('This action could not be completed. Your existing song and allowance are unchanged.')).toBeVisible();
  await prepare.click();
  await expect(page.getByRole('link', { name: 'Download MP3 now' })).toHaveAttribute('href', 'https://downloads.example/recovered.mp3');
  expect(quoteCalls).toBe(1);
  expect(exportReads).toBe(2);
  expect(startBodies).toHaveLength(2);
  expect(startBodies[1]).toEqual(startBodies[0]);
  expect(startBodies[0]).toEqual({ quote_id: quoteId, idempotency_key: expect.stringMatching(/^export\./) });
  await expect(page.getByText(/15 downloads remain/)).toBeVisible();
});

test('F19-E2 an expired MP3 quote returns to review without exposing a download', async ({ page }) => {
  await installMockSession(page);
  const songId = 'b1ed2d0d-8276-4fbb-9c4f-39f401a3158a';
  const versionId = 'b2ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const quoteId = 'b3ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  let quoteCalls = 0;
  let startCalls = 0;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith(`/music/songs/${songId}`) && request.method() === 'GET') return route.fulfill({ json: {
      id: songId, title: 'Expired allowance master', visibility: 'private',
      created_at: '2026-11-10T10:00:00Z', version_id: versionId,
      audio_url: 'data:audio/mpeg;base64,SUQz', actions: ['download_mp3'],
      current_version: { id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, created_at: '2026-11-10T10:00:00Z' },
      versions: [{ id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, is_current: true, created_at: '2026-11-10T10:00:00Z' }], lineage: [],
    } });
    if (path.endsWith(`/music/songs/${songId}/export-quotes`) && request.method() === 'POST') {
      quoteCalls += 1;
      return route.fulfill({ status: 201, json: { quote: { id: quoteId, format: 'mp3', consumes_allowance: true, allowance: 7, used: 0, remaining_after: 6, expires_at: '2026-11-10T12:05:00Z' } } });
    }
    if (path.endsWith(`/music/songs/${songId}/exports`) && request.method() === 'POST') {
      startCalls += 1;
      page.expectedConsoleErrorUrls.add(request.url());
      return route.fulfill({ status: 409, json: { error: 'quote_expired' } });
    }
    return route.abort('failed');
  });

  await page.goto(`/app/music/songs/${songId}`);
  await page.getByRole('button', { name: 'More actions for Expired allowance master' }).click();
  await page.getByRole('menuitem', { name: 'Download audio' }).click();
  await page.getByRole('button', { name: 'Review MP3 allowance' }).click();
  await page.getByRole('button', { name: 'Prepare MP3 download' }).click();
  await expect(page.getByText('The allowance quote expired. Review a fresh quote.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review MP3 allowance' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download MP3 now' })).toHaveCount(0);
  expect(quoteCalls).toBe(1);
  expect(startCalls).toBe(1);
});

test('F06-H3 owned source Cover quotes before spending and returns two lineage branches', async ({ page }) => {
  await installMockSession(page);
  const songId = '61ed2d0d-8276-4fbb-9c4f-39f401a3158a';
  const sourceVersion = '62ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const coverA = '63ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const coverB = '64ed2d0d-8276-4fbb-9c4f-39f401a3158d';
  const quoteId = '65ed2d0d-8276-4fbb-9c4f-39f401a3158e';
  const generationId = '66ed2d0d-8276-4fbb-9c4f-39f401a3158f';
  let covered = false;
  const quoteBodies = [];
  const confirmationBodies = [];
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith(`/music/songs/${songId}`) && request.method() === 'GET') {
      const versions = covered ? [
        { id: coverB, version_number: 3, operation: 'cover', parent_version_id: sourceVersion, is_current: true, created_at: '2026-11-11T12:02:00Z' },
        { id: coverA, version_number: 2, operation: 'cover', parent_version_id: sourceVersion, is_current: false, created_at: '2026-11-11T12:01:00Z' },
        { id: sourceVersion, version_number: 1, operation: 'generation', parent_version_id: null, is_current: false, created_at: '2026-11-11T12:00:00Z' },
      ] : [{ id: sourceVersion, version_number: 1, operation: 'generation', parent_version_id: null, is_current: true, created_at: '2026-11-11T12:00:00Z' }];
      return route.fulfill({ json: {
        id: songId, title: 'Owned harbour master', visibility: 'private', created_at: '2026-11-11T12:00:00Z',
        version_id: covered ? coverB : sourceVersion, audio_url: 'data:audio/mpeg;base64,SUQz',
        actions: ['view_lineage', 'cover', 'organize'], current_version: versions[0], versions,
        lineage: covered ? [
          { id: '67ed2d0d-8276-4fbb-9c4f-39f401a31580', output_version_id: coverA, source_version_id: sourceVersion, source_song_id: songId, source_title: 'Owned harbour master', source_version_number: 1, relation: 'cover_source', ordinal: 1 },
          { id: '68ed2d0d-8276-4fbb-9c4f-39f401a31581', output_version_id: coverB, source_version_id: sourceVersion, source_song_id: songId, source_title: 'Owned harbour master', source_version_number: 1, relation: 'cover_source', ordinal: 1 },
        ] : [],
      } });
    }
    if (path.endsWith(`/music/songs/${songId}/cover-quotes`) && request.method() === 'POST') {
      quoteBodies.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: {
        quote_id: quoteId, model_id: 'stable-audio-3-cover', output_count: 2,
        credits_per_candidate: 2, total_credits: 4, balance: 23, balance_after: 19,
        affordable: true, expires_at: '2026-11-11T12:05:00Z', source_duration_seconds: 42.4,
        source_influence: 60, policy_version: 'music-prompt-v1',
      } });
    }
    if (path.endsWith(`/music/songs/${songId}/covers`) && request.method() === 'POST') {
      confirmationBodies.push(request.postDataJSON());
      return route.fulfill({ status: 202, json: {
        generation_id: generationId, state: 'debited', balance_after: 19,
        candidates: [{ ordinal: 1, label: 'A', job_id: JOB_A, state: 'queued' }, { ordinal: 2, label: 'B', job_id: JOB_B, state: 'queued' }],
      } });
    }
    if (path.endsWith(`/music/generations/${generationId}`) && request.method() === 'GET') {
      covered = true;
      return route.fulfill({ json: {
        id: generationId, state: 'succeeded', model_id: 'stable-audio-3-cover', total_credits: 4,
        candidates: [
          { ordinal: 1, label: 'A', job_id: JOB_A, state: 'ready', song_id: songId, audio_url: 'data:audio/mpeg;base64,SUQz' },
          { ordinal: 2, label: 'B', job_id: JOB_B, state: 'ready', song_id: songId, audio_url: 'data:audio/mpeg;base64,SUQz' },
        ],
      } });
    }
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/music/songs/${songId}`);
  await page.getByRole('button', { name: 'More actions for Owned harbour master' }).click();
  await page.getByRole('menuitem', { name: 'Create a cover variation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cover “Owned harbour master”' });
  await dialog.getByRole('textbox', { name: 'New musical direction' }).fill('Warmer cinematic dream-pop with restrained drums');
  await dialog.getByRole('checkbox', { name: /I own or have permission/ }).check();
  await dialog.getByRole('button', { name: 'Review exact Cover quote' }).click();
  await expect(dialog.getByText('Two variations · 4 Credits total')).toBeVisible();
  await expect(dialog.getByText(/measured source 42\.4s/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm and create · 4 Credits' }).click();
  await expect(dialog.getByText('Cover pair finished')).toBeVisible();
  await expect(dialog.getByRole('slider', { name: 'Keep source character' })).toHaveCount(0);
  await expect(dialog.locator('audio')).toHaveCount(2);
  expect(quoteBodies).toEqual([{
    version_id: sourceVersion,
    prompt: 'Warmer cinematic dream-pop with restrained drums',
    source_influence: 60,
    rights_confirmed: true,
  }]);
  expect(confirmationBodies).toHaveLength(1);
  expect(confirmationBodies[0].quote_id).toBe(quoteId);
  expect(confirmationBodies[0].idempotency_key).toMatch(/^cover\./);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
  await dialog.getByRole('button', { name: 'Return to version history' }).click();
  const lineage = page.getByRole('region', { name: 'Version lineage' });
  await expect(lineage.getByText('Version 3', { exact: true })).toBeVisible();
  await expect(lineage.getByText('Cover branch').first()).toBeVisible();
  await expect(lineage.getByText(/Owned harbour master · version 1/)).toHaveCount(2);
});

test('F06-H4 tail Extend quotes two 30-second branches without overwriting the source', async ({ page }) => {
  await installMockSession(page);
  const songId = '69ed2d0d-8276-4fbb-9c4f-39f401a31582';
  const sourceVersion = '6aed2d0d-8276-4fbb-9c4f-39f401a31583';
  const extendA = '6bed2d0d-8276-4fbb-9c4f-39f401a31584';
  const extendB = '6ced2d0d-8276-4fbb-9c4f-39f401a31585';
  const quoteId = '6ded2d0d-8276-4fbb-9c4f-39f401a31586';
  const generationId = '6eed2d0d-8276-4fbb-9c4f-39f401a31587';
  let extended = false;
  const quoteBodies = [];
  const confirmationBodies = [];
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith(`/music/songs/${songId}`) && request.method() === 'GET') {
      const versions = extended ? [
        { id: extendB, version_number: 3, operation: 'extend', parent_version_id: sourceVersion, is_current: true, created_at: '2026-11-11T12:32:00Z' },
        { id: extendA, version_number: 2, operation: 'extend', parent_version_id: sourceVersion, is_current: false, created_at: '2026-11-11T12:31:00Z' },
        { id: sourceVersion, version_number: 1, operation: 'generation', parent_version_id: null, is_current: false, created_at: '2026-11-11T12:30:00Z' },
      ] : [{ id: sourceVersion, version_number: 1, operation: 'generation', parent_version_id: null, is_current: true, created_at: '2026-11-11T12:30:00Z' }];
      return route.fulfill({ json: {
        id: songId, title: 'Tail-ready harbour master', visibility: 'private', created_at: '2026-11-11T12:30:00Z',
        version_id: extended ? extendB : sourceVersion, audio_url: 'data:audio/mpeg;base64,SUQz',
        actions: ['view_lineage', 'extend', 'organize'], current_version: versions[0], versions,
        lineage: extended ? [
          { id: '6fed2d0d-8276-4fbb-9c4f-39f401a31588', output_version_id: extendA, source_version_id: sourceVersion, source_song_id: songId, source_title: 'Tail-ready harbour master', source_version_number: 1, relation: 'extend_source', ordinal: 1 },
          { id: '70ed2d0d-8276-4fbb-9c4f-39f401a31589', output_version_id: extendB, source_version_id: sourceVersion, source_song_id: songId, source_title: 'Tail-ready harbour master', source_version_number: 1, relation: 'extend_source', ordinal: 1 },
        ] : [],
      } });
    }
    if (path.endsWith(`/music/songs/${songId}/extend-quotes`) && request.method() === 'POST') {
      quoteBodies.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: {
        quote_id: quoteId, model_id: 'ace-step-extend', output_count: 2,
        credits_per_candidate: 1, total_credits: 2, balance: 19, balance_after: 17,
        affordable: true, expires_at: '2026-11-11T12:35:00Z', source_duration_seconds: 48.2,
        extend_seconds_after: 30, policy_version: 'music-prompt-v1',
      } });
    }
    if (path.endsWith(`/music/songs/${songId}/extends`) && request.method() === 'POST') {
      confirmationBodies.push(request.postDataJSON());
      return route.fulfill({ status: 202, json: {
        generation_id: generationId, state: 'debited', balance_after: 17,
        candidates: [{ ordinal: 1, label: 'A', job_id: JOB_A, state: 'queued' }, { ordinal: 2, label: 'B', job_id: JOB_B, state: 'queued' }],
      } });
    }
    if (path.endsWith(`/music/generations/${generationId}`) && request.method() === 'GET') {
      extended = true;
      return route.fulfill({ json: {
        id: generationId, state: 'succeeded', model_id: 'ace-step-extend', total_credits: 2,
        candidates: [
          { ordinal: 1, label: 'A', job_id: JOB_A, state: 'ready', song_id: songId, audio_url: 'data:audio/mpeg;base64,SUQz' },
          { ordinal: 2, label: 'B', job_id: JOB_B, state: 'ready', song_id: songId, audio_url: 'data:audio/mpeg;base64,SUQz' },
        ],
      } });
    }
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/music/songs/${songId}`);
  await page.getByRole('button', { name: 'More actions for Tail-ready harbour master' }).click();
  await page.getByRole('menuitem', { name: 'Extend by 30 seconds' }).click();
  const dialog = page.getByRole('dialog', { name: 'Extend “Tail-ready harbour master”' });
  await expect(dialog.getByText(/does not replace the ending, prepend audio, or promise a seamless transition/)).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Continuation direction' }).fill('Continue the restrained synth pulse into a clean instrumental outro');
  await dialog.getByRole('checkbox', { name: /I own or have permission/ }).check();
  await dialog.getByRole('button', { name: 'Review exact Extend quote' }).click();
  await expect(dialog.getByText('Two 30-second continuations · 2 Credits total')).toBeVisible();
  await expect(dialog.getByText(/measured source 48\.2s/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm and extend · 2 Credits' }).click();
  await expect(dialog.getByText('Extension pair finished')).toBeVisible();
  await expect(dialog.locator('audio')).toHaveCount(2);
  expect(quoteBodies).toEqual([{
    version_id: sourceVersion,
    prompt: 'Continue the restrained synth pulse into a clean instrumental outro',
    rights_confirmed: true,
  }]);
  expect(confirmationBodies).toHaveLength(1);
  expect(confirmationBodies[0].quote_id).toBe(quoteId);
  expect(confirmationBodies[0].idempotency_key).toMatch(/^extend\./);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
  await dialog.getByRole('button', { name: 'Return to version history' }).click();
  const lineage = page.getByRole('region', { name: 'Version lineage' });
  await expect(lineage.getByText('Version 3', { exact: true })).toBeVisible();
  await expect(lineage.getByText('Extended branch').first()).toBeVisible();
  await expect(lineage.getByText(/Tail-ready harbour master · version 1/)).toHaveCount(2);
});

test('F07-H1 Replace Section quotes an exact range and preserves both alternate branches', async ({ page }) => {
  await installMockSession(page);
  const songId = '81ed2d0d-8276-4fbb-9c4f-39f401a3158a';
  const sourceVersion = '82ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const replaceA = '83ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const replaceB = '84ed2d0d-8276-4fbb-9c4f-39f401a3158d';
  const quoteId = '85ed2d0d-8276-4fbb-9c4f-39f401a3158e';
  const generationId = '86ed2d0d-8276-4fbb-9c4f-39f401a3158f';
  let generated = false;
  let committedVersion = null;
  const quoteBodies = [];
  const confirmationBodies = [];
  const commitBodies = [];
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith(`/music/songs/${songId}`) && request.method() === 'GET') {
      const versions = generated ? [
        { id: replaceB, version_number: 3, operation: 'replace_section', parent_version_id: sourceVersion, is_current: committedVersion === replaceB, created_at: '2026-11-11T12:47:00Z' },
        { id: replaceA, version_number: 2, operation: 'replace_section', parent_version_id: sourceVersion, is_current: committedVersion === replaceA, created_at: '2026-11-11T12:46:00Z' },
        { id: sourceVersion, version_number: 1, operation: 'generation', parent_version_id: null, is_current: !committedVersion, created_at: '2026-11-11T12:45:00Z' },
      ] : [{ id: sourceVersion, version_number: 1, operation: 'generation', parent_version_id: null, is_current: true, created_at: '2026-11-11T12:45:00Z' }];
      const currentVersion = versions.find((version) => version.is_current) || versions[versions.length - 1];
      return route.fulfill({ json: {
        id: songId, title: 'Range-ready harbour master', visibility: 'private', created_at: '2026-11-11T12:45:00Z',
        version_id: committedVersion || sourceVersion, audio_url: 'data:audio/mpeg;base64,SUQz',
        actions: ['view_lineage', 'replace_section', 'organize'], current_version: currentVersion, versions,
        lineage: generated ? [
          { id: '87ed2d0d-8276-4fbb-9c4f-39f401a31580', output_version_id: replaceA, source_version_id: sourceVersion, source_song_id: songId, source_title: 'Range-ready harbour master', source_version_number: 1, relation: 'edit_source', ordinal: 1 },
          { id: '88ed2d0d-8276-4fbb-9c4f-39f401a31581', output_version_id: replaceB, source_version_id: sourceVersion, source_song_id: songId, source_title: 'Range-ready harbour master', source_version_number: 1, relation: 'edit_source', ordinal: 1 },
        ] : [],
      } });
    }
    if (path.endsWith(`/music/songs/${songId}/replace-quotes`) && request.method() === 'POST') {
      quoteBodies.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: {
        quote_id: quoteId, model_id: 'ace-step-replace-section', output_count: 2,
        credits_per_candidate: 1, total_credits: 2, balance: 17, balance_after: 15,
        affordable: true, expires_at: '2026-11-11T12:50:00Z', source_duration_seconds: 48.2,
        start_seconds: 12.5, end_seconds: 24, policy_version: 'music-prompt-v1',
      } });
    }
    if (path.endsWith(`/music/songs/${songId}/replacements`) && request.method() === 'POST') {
      confirmationBodies.push(request.postDataJSON());
      return route.fulfill({ status: 202, json: {
        generation_id: generationId, state: 'debited', balance_after: 15,
        candidates: [{ ordinal: 1, label: 'A', job_id: JOB_A, state: 'queued' }, { ordinal: 2, label: 'B', job_id: JOB_B, state: 'queued' }],
      } });
    }
    if (path.endsWith(`/music/generations/${generationId}`) && request.method() === 'GET') {
      generated = true;
      return route.fulfill({ json: {
        id: generationId, state: 'succeeded', model_id: 'ace-step-replace-section', total_credits: 2,
        candidates: [
          { ordinal: 1, label: 'A', job_id: JOB_A, state: 'ready', song_id: songId, version_id: replaceA, audio_url: 'data:audio/mpeg;base64,SUQz' },
          { ordinal: 2, label: 'B', job_id: JOB_B, state: 'ready', song_id: songId, version_id: replaceB, audio_url: 'data:audio/mpeg;base64,SUQz' },
        ],
      } });
    }
    if (path.endsWith(`/music/songs/${songId}/replacements/commit`) && request.method() === 'POST') {
      const body = request.postDataJSON();
      commitBodies.push(body);
      committedVersion = body.version_id;
      return route.fulfill({ json: { version_id: body.version_id, idempotent: false } });
    }
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/music/songs/${songId}`);
  await page.getByRole('button', { name: 'More actions for Range-ready harbour master' }).click();
  await page.getByRole('menuitem', { name: 'Replace a section' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replace a section of “Range-ready harbour master”' });
  await expect(dialog.getByText(/Audition both full-song takes, then commit one as current/)).toBeVisible();
  await dialog.getByRole('spinbutton', { name: 'Start seconds' }).fill('12.5');
  await dialog.getByRole('spinbutton', { name: 'End seconds' }).fill('24');
  await dialog.getByRole('textbox', { name: 'Replacement direction' }).fill('Replace the bridge with a sparse modal synth passage');
  await dialog.getByRole('checkbox', { name: /I own or have permission/ }).check();
  await dialog.getByRole('button', { name: 'Review exact replacement quote' }).click();
  await expect(dialog.getByText('Two section alternatives · 2 Credits total')).toBeVisible();
  await expect(dialog.getByText(/12\.5s–24\.0s of a measured 48\.2s source/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm and generate · 2 Credits' }).click();
  await expect(dialog.getByText('Replacement pair finished')).toBeVisible();
  await expect(dialog.locator('audio')).toHaveCount(2);
  expect(quoteBodies).toEqual([{
    version_id: sourceVersion,
    prompt: 'Replace the bridge with a sparse modal synth passage',
    start_seconds: 12.5,
    end_seconds: 24,
    rights_confirmed: true,
  }]);
  expect(confirmationBodies).toHaveLength(1);
  expect(confirmationBodies[0].quote_id).toBe(quoteId);
  expect(confirmationBodies[0].idempotency_key).toMatch(/^replace\./);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
  await dialog.getByRole('button', { name: 'Use alternative B as current' }).click();
  await expect(dialog.getByText('Alternative B is now current.')).toBeVisible();
  expect(commitBodies).toEqual([{
    generation_id: generationId,
    version_id: replaceB,
    idempotency_key: `replace-commit.${generationId}.${replaceB}`,
  }]);
  await dialog.getByRole('button', { name: 'Open committed version history' }).click();
  const lineage = page.getByRole('region', { name: 'Version lineage' });
  await expect(lineage.getByText('Version 3', { exact: true })).toBeVisible();
  await expect(lineage.getByText('Current')).toHaveCount(1);
  await expect(lineage.getByText('Replaced section').first()).toBeVisible();
  await expect(lineage.getByText(/Range-ready harbour master · version 1/)).toHaveCount(2);
});

test('F07-H2 Add Section freezes edge, duration, lyrics and style into two immutable branches', async ({ page }) => {
  await installMockSession(page);
  const songId = '31ed2d0d-8276-4fbb-9c4f-39f401a31580';
  const sourceVersion = '32ed2d0d-8276-4fbb-9c4f-39f401a31581';
  const sectionA = '33ed2d0d-8276-4fbb-9c4f-39f401a31582';
  const sectionB = '34ed2d0d-8276-4fbb-9c4f-39f401a31583';
  const quoteId = '35ed2d0d-8276-4fbb-9c4f-39f401a31584';
  const generationId = '36ed2d0d-8276-4fbb-9c4f-39f401a31585';
  let added = false;
  const quoteBodies = [];
  const confirmationBodies = [];
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith(`/music/songs/${songId}`) && request.method() === 'GET') {
      const versions = added ? [
        { id: sectionB, version_number: 3, operation: 'add_section', parent_version_id: sourceVersion, is_current: true, created_at: '2026-11-11T17:02:00Z' },
        { id: sectionA, version_number: 2, operation: 'add_section', parent_version_id: sourceVersion, is_current: false, created_at: '2026-11-11T17:01:00Z' },
        { id: sourceVersion, version_number: 1, operation: 'generation', parent_version_id: null, is_current: false, created_at: '2026-11-11T17:00:00Z' },
      ] : [{ id: sourceVersion, version_number: 1, operation: 'generation', parent_version_id: null, is_current: true, created_at: '2026-11-11T17:00:00Z' }];
      return route.fulfill({ json: {
        id: songId, title: 'Bridge over harbour light', visibility: 'private', created_at: '2026-11-11T17:00:00Z',
        version_id: added ? sectionB : sourceVersion, audio_url: 'data:audio/wav;base64,UklGRg==',
        actions: ['view_lineage', 'add_section', 'organize'], current_version: versions[0], versions,
        lineage: added ? [
          { id: '37ed2d0d-8276-4fbb-9c4f-39f401a31586', output_version_id: sectionA, source_version_id: sourceVersion, source_title: 'Bridge over harbour light', source_version_number: 1, relation: 'edit_source', ordinal: 1 },
          { id: '38ed2d0d-8276-4fbb-9c4f-39f401a31587', output_version_id: sectionB, source_version_id: sourceVersion, source_title: 'Bridge over harbour light', source_version_number: 1, relation: 'edit_source', ordinal: 1 },
        ] : [],
      } });
    }
    if (path.endsWith(`/music/songs/${songId}/add-section-quotes`) && request.method() === 'POST') {
      quoteBodies.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: {
        quote_id: quoteId, model_id: 'ace-step-add-section', output_count: 2,
        credits_per_candidate: 1, total_credits: 2, balance: 18, balance_after: 16,
        affordable: true, expires_at: '2026-11-11T17:05:00Z', source_duration_seconds: 48.2,
        position: 'end', duration_seconds: 20, instrumental: false, policy_version: 'music-prompt-v1',
      } });
    }
    if (path.endsWith(`/music/songs/${songId}/sections`) && request.method() === 'POST') {
      confirmationBodies.push(request.postDataJSON());
      return route.fulfill({ status: 202, json: {
        generation_id: generationId, state: 'debited', balance_after: 16,
        candidates: [{ ordinal: 1, label: 'A', job_id: JOB_A, state: 'queued' }, { ordinal: 2, label: 'B', job_id: JOB_B, state: 'queued' }],
      } });
    }
    if (path.endsWith(`/music/generations/${generationId}`) && request.method() === 'GET') {
      added = true;
      return route.fulfill({ json: {
        id: generationId, state: 'succeeded', model_id: 'ace-step-add-section', total_credits: 2,
        candidates: [
          { ordinal: 1, label: 'A', job_id: JOB_A, state: 'ready', song_id: songId, audio_url: 'data:audio/wav;base64,UklGRg==' },
          { ordinal: 2, label: 'B', job_id: JOB_B, state: 'ready', song_id: songId, audio_url: 'data:audio/wav;base64,UklGRg==' },
        ],
      } });
    }
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/music/songs/${songId}`);
  await page.getByRole('button', { name: 'More actions for Bridge over harbour light' }).click();
  await page.getByRole('menuitem', { name: 'Add a new section' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a section to “Bridge over harbour light”' });
  await expect(dialog.getByText(/does not insert into the middle, count beats/)).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Section style' }).fill('Restrained synth bridge with brushed drums');
  await dialog.getByRole('textbox', { name: 'Section lyrics' }).fill('[Bridge]\nHold the harbour light');
  await dialog.getByRole('checkbox', { name: /I own or have permission/ }).check();
  await dialog.getByRole('button', { name: 'Review exact Add Section quote' }).click();
  await expect(dialog.getByText('Two 20-second end sections · 2 Credits total')).toBeVisible();
  await expect(dialog.getByText(/Structured lyrics · measured source 48.2s/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm and add section · 2 Credits' }).click();
  await expect(dialog.getByText('Section pair finished')).toBeVisible();
  await expect(dialog.locator('audio')).toHaveCount(2);
  expect(quoteBodies).toEqual([{
    version_id: sourceVersion, position: 'end', duration_seconds: 20,
    lyrics: '[Bridge]\nHold the harbour light', styles: 'Restrained synth bridge with brushed drums', rights_confirmed: true,
  }]);
  expect(confirmationBodies).toHaveLength(1);
  expect(confirmationBodies[0].quote_id).toBe(quoteId);
  expect(confirmationBodies[0].idempotency_key).toMatch(/^add-section\./);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
  await dialog.getByRole('button', { name: 'Return to version history' }).click();
  const lineage = page.getByRole('region', { name: 'Version lineage' });
  await expect(lineage.getByText('Version 3', { exact: true })).toBeVisible();
  await expect(lineage.getByText('Added section').first()).toBeVisible();
  await expect(lineage.getByText(/Bridge over harbour light · version 1/)).toHaveCount(2);
});

test('F06-H5 owned styles and lyrics reuse replaces only selected Custom draft fields', async ({ page }) => {
  await installMockSession(page);
  const songId = '91ed2d0d-8276-4fbb-9c4f-39f401a3158a';
  const versionId = '92ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const applyBodies = [];
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith(`/music/songs/${songId}`) && request.method() === 'GET') return route.fulfill({ json: {
      id: songId, title: 'Reusable harbour song', visibility: 'private', created_at: '2026-11-11T14:00:00Z',
      version_id: versionId, audio_url: 'data:audio/mpeg;base64,SUQz', actions: ['view_lineage', 'reuse', 'organize'],
      current_version: { id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, created_at: '2026-11-11T14:00:00Z' },
      versions: [{ id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, is_current: true, created_at: '2026-11-11T14:00:00Z' }], lineage: [],
    } });
    if (path.endsWith(`/music/songs/${songId}/reuse`) && request.method() === 'GET') {
      expect(url.searchParams.get('version_id')).toBe(versionId);
      return route.fulfill({ json: {
        source: { song_id: songId, version_id: versionId, title: 'Reusable harbour song', source_mode: 'custom', lyrics: '[Verse]\nOwned harbour lines', styles: 'Sparse modal synth, restrained percussion', has_lyrics: true, has_styles: true },
        draft_revision: 7,
      } });
    }
    if (path.endsWith(`/music/songs/${songId}/reuse`) && request.method() === 'POST') {
      applyBodies.push(request.postDataJSON());
      return route.fulfill({ json: { draft: { id: '93ed2d0d-8276-4fbb-9c4f-39f401a3158c', model_id: 'ace-step-1.5', lyrics: 'Existing draft lyrics', styles: 'Sparse modal synth, restrained percussion', title: 'Unchanged title', revision: 8, updated_at: '2026-11-11T14:02:00Z' }, idempotent: false } });
    }
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/music/songs/${songId}`);
  await page.getByRole('button', { name: 'More actions for Reusable harbour song' }).click();
  await page.getByRole('menuitem', { name: 'Reuse styles and lyrics' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reuse from “Reusable harbour song”' });
  await expect(dialog.getByText(/creates no audio, spends no credits/)).toBeVisible();
  await expect(dialog.getByText('Sparse modal synth, restrained percussion')).toBeVisible();
  await dialog.getByRole('checkbox', { name: /Reuse owned lyrics/ }).uncheck();
  await dialog.getByRole('button', { name: 'Apply to private Custom draft' }).click();
  await expect(dialog.getByText('Reusable material saved to Custom.')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open reused Custom draft' })).toHaveAttribute('href', '/app/music/create?mode=custom');
  expect(applyBodies).toHaveLength(1);
  expect(applyBodies[0]).toEqual({
    version_id: versionId,
    draft_revision: 7,
    reuse_lyrics: false,
    reuse_styles: true,
    idempotency_key: expect.stringMatching(/^reuse\./),
  });
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F09-H1 stem separation discloses absent-part spend before one private archive job', async ({ page }) => {
  await installMockSession(page);
  const songId = '71ed2d0d-8276-4fbb-9c4f-39f401a3158a';
  const versionId = '72ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const quoteId = '73ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const requestId = '74ed2d0d-8276-4fbb-9c4f-39f401a3158d';
  const stemJob = '75ed2d0d-8276-4fbb-9c4f-39f401a3158e';
  const quoteBodies = [];
  const confirmationBodies = [];
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith(`/music/songs/${songId}`) && request.method() === 'GET') return route.fulfill({ json: {
      id: songId, title: 'Stem-ready harbour mix', visibility: 'private', created_at: '2026-11-11T13:00:00Z',
      version_id: versionId, audio_url: 'data:audio/mpeg;base64,SUQz', actions: ['view_lineage', 'stems', 'organize'],
      current_version: { id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, created_at: '2026-11-11T13:00:00Z' },
      versions: [{ id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, is_current: true, created_at: '2026-11-11T13:00:00Z' }], lineage: [],
    } });
    if (path.endsWith(`/music/songs/${songId}/stem-quotes`) && request.method() === 'POST') {
      quoteBodies.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: {
        quote_id: quoteId, model_id: 'mureka-stems-v3', total_credits: 13,
        balance: 23, balance_after: 10, affordable: true, expires_at: '2026-11-11T13:05:00Z',
        outputs: ['vocals', 'instrumental'],
      } });
    }
    if (path.endsWith(`/music/songs/${songId}/stems`) && request.method() === 'POST') {
      confirmationBodies.push(request.postDataJSON());
      return route.fulfill({ status: 202, json: {
        request_id: requestId, job_id: stemJob, state: 'queued', balance_after: 10,
      } });
    }
    if (path.endsWith(`/music/stem-requests/${requestId}`) && request.method() === 'GET') return route.fulfill({ json: {
      id: requestId, song_id: songId, source_version_id: versionId, job_id: stemJob,
      model_id: 'mureka-stems-v3', credits: 13, state: 'ready',
      archive_url: `/api/v1/music/stem-requests/${requestId}/archive`,
    } });
    if (path.endsWith(`/music/stem-requests/${requestId}/archive`) && request.method() === 'GET') return route.fulfill({ json: {
      url: 'https://downloads.example/private-vocals-instrumental.zip',
      mime_type: 'application/zip', size_bytes: 4_200_000, expires_in: 300,
    } });
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/music/songs/${songId}`);
  await page.getByRole('button', { name: 'More actions for Stem-ready harbour mix' }).click();
  await page.getByRole('menuitem', { name: 'Separate vocals and instrumental' }).click();
  const dialog = page.getByRole('dialog', { name: 'Get stems for “Stem-ready harbour mix”' });
  await expect(dialog.getByText(/If vocals or a clear instrumental part are absent/)).toBeVisible();
  await expect(dialog.getByText(/can still spend the quoted credits/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Review exact stem quote' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /I own or have permission/ }).check();
  await dialog.getByRole('button', { name: 'Review exact stem quote' }).click();
  await expect(dialog.getByText('Vocals + instrumental archive · 13 Credits')).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm separation · 13 Credits' }).click();
  await expect(dialog.getByText('ready', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Prepare private ZIP download' }).click();
  await expect(dialog.getByRole('link', { name: 'Download vocals + instrumental ZIP' })).toHaveAttribute('href', 'https://downloads.example/private-vocals-instrumental.zip');
  expect(quoteBodies).toEqual([{ version_id: versionId, rights_confirmed: true }]);
  expect(confirmationBodies).toHaveLength(1);
  expect(confirmationBodies[0].quote_id).toBe(quoteId);
  expect(confirmationBodies[0].idempotency_key).toMatch(/^stems\./);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F09-H2 one instrument split quotes measured duration and returns target plus residual WAVs', async ({ page }) => {
  await installMockSession(page);
  const songId = '61ed2d0d-8276-4fbb-9c4f-39f401a3158a';
  const versionId = '62ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const quoteId = '63ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const requestId = '64ed2d0d-8276-4fbb-9c4f-39f401a3158d';
  const jobId = '65ed2d0d-8276-4fbb-9c4f-39f401a3158e';
  const quoteBodies = []; const confirmationBodies = [];
  const audio = `data:audio/wav;base64,${wav(1).toString('base64')}`;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith(`/music/songs/${songId}`) && request.method() === 'GET') return route.fulfill({ json: {
      id: songId, title: 'Layered midnight ensemble', visibility: 'private', created_at: '2026-11-11T15:00:00Z',
      version_id: versionId, audio_url: audio, actions: ['view_lineage', 'target_stem', 'organize'],
      current_version: { id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, created_at: '2026-11-11T15:00:00Z' },
      versions: [{ id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, is_current: true, created_at: '2026-11-11T15:00:00Z' }], lineage: [],
    } });
    if (path.endsWith(`/music/songs/${songId}/target-stem-quotes`) && request.method() === 'POST') {
      quoteBodies.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: {
        quote_id: quoteId, model_id: 'sam-audio-target-stem', instrument: 'piano',
        source_duration_seconds: 61.2, total_credits: 10, balance: 23, balance_after: 13,
        affordable: true, expires_at: '2026-11-11T15:05:00Z', outputs: ['target', 'residual'],
      } });
    }
    if (path.endsWith(`/music/songs/${songId}/target-stems`) && request.method() === 'POST') {
      confirmationBodies.push(request.postDataJSON());
      return route.fulfill({ status: 202, json: { request_id: requestId, job_id: jobId, state: 'queued', balance_after: 13 } });
    }
    if (path.endsWith(`/music/target-stem-requests/${requestId}`) && request.method() === 'GET') return route.fulfill({ json: {
      id: requestId, song_id: songId, source_version_id: versionId, job_id: jobId,
      model_id: 'sam-audio-target-stem', instrument: 'piano', credits: 10,
      state: 'ready', outputs: ['target', 'residual'],
    } });
    if (path.endsWith(`/music/target-stem-requests/${requestId}/target`) && request.method() === 'GET') return route.fulfill({ json: {
      url: audio, mime_type: 'audio/wav', size_bytes: wav(1).length, expires_in: 300, kind: 'target',
    } });
    if (path.endsWith(`/music/target-stem-requests/${requestId}/residual`) && request.method() === 'GET') return route.fulfill({ json: {
      url: audio, mime_type: 'audio/wav', size_bytes: wav(1).length, expires_in: 300, kind: 'residual',
    } });
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/music/songs/${songId}`);
  await page.getByRole('button', { name: 'More actions for Layered midnight ensemble' }).click();
  await page.getByRole('menuitem', { name: 'Isolate one instrument' }).click();
  const dialog = page.getByRole('dialog', { name: 'Isolate one instrument from “Layered midnight ensemble”' });
  await expect(dialog.getByText(/isolated target and a residual containing everything else/)).toBeVisible();
  await expect(dialog.getByText(/absent, ambiguous, or heavily blended/)).toBeVisible();
  await dialog.getByLabel('Target sound').selectOption('piano');
  await expect(dialog.getByRole('button', { name: 'Review exact isolation quote' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /I own or have permission/ }).check();
  await dialog.getByRole('button', { name: 'Review exact isolation quote' }).click();
  await expect(dialog.getByText('piano + residual WAV · 10 Credits')).toBeVisible();
  await expect(dialog.getByText(/61\.2 seconds · balance 23 → 13/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm isolation · 10 Credits' }).click();
  await expect(dialog.getByText('ready', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Prepare target + residual WAVs' }).click();
  await expect(dialog.locator('audio')).toHaveCount(2);
  await expect(dialog.getByRole('link', { name: 'Download target WAV' })).toHaveAttribute('href', audio);
  await expect(dialog.getByRole('link', { name: 'Download residual WAV' })).toHaveAttribute('href', audio);
  expect(quoteBodies).toEqual([{ version_id: versionId, instrument: 'piano', rights_confirmed: true }]);
  expect(confirmationBodies).toHaveLength(1);
  expect(confirmationBodies[0].quote_id).toBe(quoteId);
  expect(confirmationBodies[0].idempotency_key).toMatch(/^target-stem\./);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F07-H3 add vocals freezes lyrics, confirms both paid stages, and returns a separate part', async ({ page }) => {
  await installMockSession(page);
  const songId = '71ed2d0d-8276-4fbb-9c4f-39f401a3158a';
  const versionId = '72ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const quoteId = '73ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const requestId = '74ed2d0d-8276-4fbb-9c4f-39f401a3158d';
  const uploadJob = '75ed2d0d-8276-4fbb-9c4f-39f401a3158e';
  const trackJob = '76ed2d0d-8276-4fbb-9c4f-39f401a3158f';
  const quoteBodies = []; const confirmationBodies = [];
  const audio = `data:audio/wav;base64,${wav(1).toString('base64')}`;
  await page.route('**/api/v1/music/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith(`/music/songs/${songId}`) && request.method() === 'GET') return route.fulfill({ json: {
      id: songId, title: 'Open-sky instrumental', visibility: 'private', created_at: '2026-11-11T16:00:00Z',
      version_id: versionId, audio_url: audio, actions: ['view_lineage', 'add_track', 'organize'],
      current_version: { id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, created_at: '2026-11-11T16:00:00Z' },
      versions: [{ id: versionId, version_number: 1, operation: 'generation', parent_version_id: null, is_current: true, created_at: '2026-11-11T16:00:00Z' }], lineage: [],
    } });
    if (path.endsWith(`/music/songs/${songId}/track-add-quotes`) && request.method() === 'POST') {
      quoteBodies.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: { quote_id: quoteId, mode: 'vocals', source_duration_seconds: 58.4,
        upload_credits: 1, track_credits: 6, total_credits: 7, balance: 23, balance_after: 16,
        affordable: true, expires_at: '2026-11-11T16:05:00Z' } });
    }
    if (path.endsWith(`/music/songs/${songId}/track-adds`) && request.method() === 'POST') {
      confirmationBodies.push(request.postDataJSON());
      return route.fulfill({ status: 202, json: { request_id: requestId, upload_job_id: uploadJob, track_job_id: trackJob, state: 'queued', balance_after: 16 } });
    }
    if (path.endsWith(`/music/track-add-requests/${requestId}`) && request.method() === 'GET') return route.fulfill({ json: {
      id: requestId, song_id: songId, source_version_id: versionId, mode: 'vocals', upload_job_id: uploadJob,
      track_job_id: trackJob, upload_credits: 1, track_credits: 6, state: 'ready', stage: 'complete',
    } });
    if (path.endsWith(`/music/track-add-requests/${requestId}/audio`) && request.method() === 'GET') return route.fulfill({ json: {
      url: audio, mime_type: 'audio/wav', size_bytes: wav(1).length, expires_in: 300,
    } });
    return route.abort('failed');
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/music/songs/${songId}`);
  await page.getByRole('button', { name: 'More actions for Open-sky instrumental' }).click();
  await page.getByRole('menuitem', { name: 'Add vocals or instrumental' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a part to “Open-sky instrumental”' });
  await expect(dialog.getByText(/separate private track/)).toBeVisible();
  await expect(dialog.getByText(/does not mix it into the source automatically/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Add instrumental' }).click();
  await expect(dialog.getByLabel('Exact lyrics')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Add vocals' }).click();
  await expect(dialog.getByLabel('Exact lyrics')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Review exact two-stage quote' })).toBeDisabled();
  await dialog.getByLabel('Direction').fill('Warm intimate lead vocal');
  await dialog.getByLabel('Vocal range preference').selectOption('female');
  await dialog.getByLabel('Exact lyrics').fill('Stay with me beneath the open sky');
  await dialog.getByRole('checkbox', { name: /permission to use these lyrics/ }).check();
  await dialog.getByRole('checkbox', { name: /permission to use this recording/ }).check();
  await dialog.getByRole('button', { name: 'Review exact two-stage quote' }).click();
  await expect(dialog.getByText('Vocal part · 7 Credits')).toBeVisible();
  await expect(dialog.getByText(/Upload 1 \+ generation 6 · balance 23 → 16/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm both stages · 7 Credits' }).click();
  await expect(dialog.getByText('ready', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Prepare generated part' }).click();
  await expect(dialog.locator('audio')).toHaveCount(1);
  await expect(dialog.getByRole('link', { name: 'Download separate generated part' })).toHaveAttribute('href', audio);
  expect(quoteBodies).toEqual([{ version_id: versionId, mode: 'vocals', prompt: 'Warm intimate lead vocal',
    lyrics: 'Stay with me beneath the open sky', vocal_gender: 'female', rights_confirmed: true, lyrics_rights_confirmed: true }]);
  expect(confirmationBodies[0].quote_id).toBe(quoteId);
  expect(confirmationBodies[0].idempotency_key).toMatch(/^track-add\./);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F21-H1/F22-H1 an owned song opens in Studio and records local audio plus MIDI', async ({ page }) => {
  await installMockSession(page);
  await page.addInitScript(() => {
    window.__studioMicrophoneRequests = [];
    window.__studioMidiRequests = 0;
    const track = { stop() {} };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      async getUserMedia(constraints) {
        window.__studioMicrophoneRequests.push(constraints);
        return { getTracks: () => [track] };
      },
      async enumerateDevices() {
        return [{ kind: 'audioinput', deviceId: 'built-in', label: 'Built-in microphone' },
          { kind: 'audioinput', deviceId: 'usb-mic', label: 'USB microphone' }];
      },
    } });
    class FakeMediaRecorder {
      static isTypeSupported() { return true; }
      constructor() { this.mimeType = 'audio/webm;codecs=opus'; this.state = 'inactive'; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) });
          this.onstop?.();
        });
      }
    }
    window.__studioMediaSourceRequests = 0;
    window.__studioBiquadRequests = 0;
    window.__studioPeriodicWaveRequests = 0;
    window.__studioCalibrationAnalysers = 0;
    window.__studioMasterTargets = [];
    const parameter = (value = 0, track = false) => ({ value,
      setValueAtTime(next) { this.value = next; },
      linearRampToValueAtTime(next) { this.value = next; },
      exponentialRampToValueAtTime(next) { this.value = next; },
      cancelScheduledValues() {},
      setTargetAtTime(next) { this.value = next; if (track) window.__studioMasterTargets.push(next); },
    });
    const node = (extras = {}) => ({ ...extras, connect() { return arguments[0] || this; }, disconnect() {} });
    class FakeAudioContext {
      constructor() { this.currentTime = 0; this.sampleRate = 48_000; this.destination = node(); }
      async decodeAudioData() {
        const samples = new Float32Array([0, 0.25, -0.25, 0]);
        return { numberOfChannels: 1, length: samples.length, sampleRate: 8_000, getChannelData: () => samples };
      }
      async close() {}
      async resume() {}
      createMediaElementSource() { window.__studioMediaSourceRequests += 1; return node(); }
      createOscillator() { return node({ frequency: parameter(), setPeriodicWave() {}, start() {}, stop() {} }); }
      createGain() { return node({ gain: parameter(1, true) }); }
      createBiquadFilter() { window.__studioBiquadRequests += 1; return node({ frequency: parameter(), Q: parameter(), gain: parameter() }); }
      createDynamicsCompressor() { return node({ threshold: parameter(), ratio: parameter() }); }
      createWaveShaper() { return node({ curve: null, oversample: 'none' }); }
      createDelay() { return node({ delayTime: parameter() }); }
      createConvolver() { return node({ buffer: null }); }
      createMediaStreamSource() { return node(); }
      createAnalyser() { window.__studioCalibrationAnalysers += 1; return node({ fftSize: 0, getFloatTimeDomainData(samples) { samples.fill(0.2); } }); }
      createPeriodicWave() { window.__studioPeriodicWaveRequests += 1; return {}; }
      createBuffer(channels, length, sampleRate = this.sampleRate) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { numberOfChannels: channels, length, sampleRate, getChannelData: (channel) => data[channel] }; }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FakeMediaRecorder });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
    const midiInput = { id: 'test-keys', name: 'Test Keys', onmidimessage: null };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => {
      window.__studioMidiRequests += 1;
      return { inputs: new Map([[midiInput.id, midiInput]]), onstatechange: null };
    } });
    window.__studioSendMidi = (data) => midiInput.onmidimessage?.({ data: new Uint8Array(data) });
  });
  const songId = '81ed2d0d-8276-4fbb-9c4f-39f401a3158a';
  const first = '82ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const second = '83ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  const audio = `data:audio/wav;base64,${wav(2).toString('base64')}`;
  await page.route(`**/api/v1/music/songs/${songId}`, async (route) => route.fulfill({ json: {
    id: songId, title: 'Studio foundations', visibility: 'private', created_at: '2026-11-11T17:00:00Z',
    version_id: second, audio_url: audio, actions: ['view_lineage', 'open_studio', 'organize'],
    current_version: { id: second, version_number: 2, operation: 'crop', parent_version_id: first, created_at: '2026-11-11T17:01:00Z' },
    versions: [{ id: second, version_number: 2, operation: 'crop', parent_version_id: first, is_current: true, created_at: '2026-11-11T17:01:00Z' },
      { id: first, version_number: 1, operation: 'generation', parent_version_id: null, is_current: false, created_at: '2026-11-11T17:00:00Z' }], lineage: [],
  } }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/music/songs/${songId}`);
  await page.getByRole('button', { name: 'More actions for Studio foundations' }).click();
  await page.getByRole('menuitem', { name: 'Open in Studio workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/music/studio/${songId}$`));
  await expect(page.getByRole('heading', { name: 'Studio foundations' })).toBeVisible();
  await expect(page.getByText('Unsaved local session')).toBeVisible();
  await expect(page.getByText('No project save')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Studio timeline' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Studio Library dock' })).toContainText('Version 2');
  await page.getByLabel('Tempo guide').fill('96');
  await page.getByLabel('Time signature').selectOption('3/4');
  await page.getByLabel('Grid density').selectOption('dense');
  await page.getByLabel('Grid contrast').selectOption('high');
  await page.getByLabel('Track volume').fill('0.6');
  await page.getByRole('checkbox', { name: 'Loop' }).check();
  await page.getByRole('checkbox', { name: 'Metronome' }).check();
  await page.getByRole('checkbox', { name: 'Mute' }).check();
  await expect(page.getByText('Project guide · 96 BPM · 3/4')).toBeVisible();
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(page.getByText('Track hidden from timeline')).toBeVisible();
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByText(/Local clip renders, microphone takes, measured latency, MIDI notes, effects and automation are unsaved/)).toBeVisible();
  expect(await page.evaluate(() => window.__studioMicrophoneRequests)).toEqual([]);
  await page.getByRole('button', { name: 'Prepare input' }).click();
  await expect(page.getByLabel('Audio input', { exact: true })).toHaveValue('built-in');
  await page.getByLabel('Audio input', { exact: true }).selectOption('usb-mic');
  await page.getByLabel('Lead-in mode').selectOption('count-in');
  await expect(page.getByLabel('Lead-in bars')).toBeEnabled();
  await page.getByLabel('Lead-in mode').selectOption('none');
  await page.getByRole('button', { name: 'Record audio take' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByLabel('Recorded take lanes')).toContainText('Take 1');
  await expect(page.getByRole('link', { name: 'Download WAV take' })).toHaveAttribute('download', 'veyrnox-studio-take-1.wav');
  await expect(page.getByText(/not uploaded or saved with this song/)).toBeVisible();
  expect(await page.evaluate(() => window.__studioMicrophoneRequests)).toEqual([
    { audio: true },
    { audio: { deviceId: { exact: 'usb-mic' } } },
  ]);
  await page.getByRole('button', { name: 'Prepare calibration input' }).click();
  await page.getByLabel('Calibration audio input').selectOption('usb-mic');
  await page.getByRole('button', { name: 'Run click measurement' }).click();
  await expect(page.getByText(/Measured .* ms from 3 of 3 return clicks/)).toBeVisible();
  await expect(page.getByText('3/3 clicks detected')).toBeVisible();
  expect(await page.evaluate(() => window.__studioCalibrationAnalysers)).toBe(1);
  expect(await page.evaluate(() => window.__studioMidiRequests)).toBe(0);
  await page.getByRole('button', { name: 'Enable external MIDI' }).click();
  await expect(page.getByLabel('MIDI input')).toHaveValue('test-keys');
  await page.getByRole('button', { name: 'Add C4 note' }).click();
  await page.getByLabel('Start beat note 1').fill('0.33');
  await page.getByLabel('Velocity note 1').fill('88');
  await page.getByRole('button', { name: 'Quantize to 1/16' }).click();
  await expect(page.getByLabel('Start beat note 1')).toHaveValue('0.25');
  await page.getByRole('button', { name: 'Enable musical typing' }).click();
  await page.getByRole('button', { name: 'Start MIDI capture' }).click();
  await page.keyboard.press('a');
  await page.evaluate(() => window.__studioSendMidi([0x90, 64, 100]));
  await page.waitForTimeout(40);
  await page.evaluate(() => window.__studioSendMidi([0x80, 64, 0]));
  await page.getByRole('button', { name: 'Stop MIDI capture' }).click();
  await expect(page.getByLabel('MIDI piano roll').getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'Play MIDI clip' }).click();
  await page.getByLabel('Synth preset').selectOption('pad');
  await expect(page.getByLabel('Wavetable A')).toHaveValue('warm');
  await expect(page.getByLabel('Synth filter cutoff')).toHaveValue('3200');
  await page.getByLabel('Wavetable morph').fill('0.4');
  await expect(page.getByLabel('Synth preset')).toHaveValue('custom');
  await page.getByRole('button', { name: 'Open floating synth keyboard' }).click();
  const synthKey = page.getByRole('button', { name: 'Play C4' });
  await synthKey.dispatchEvent('pointerdown');
  await synthKey.dispatchEvent('pointerup');
  await expect(page.getByRole('dialog', { name: 'Floating wavetable keyboard' })).toBeVisible();
  await page.getByRole('button', { name: 'Close floating synth keyboard' }).click();
  expect(await page.evaluate(() => window.__studioPeriodicWaveRequests)).toBeGreaterThanOrEqual(10);
  expect(await page.evaluate(() => window.__studioMidiRequests)).toBe(1);
  expect(await page.evaluate(() => window.__studioMediaSourceRequests)).toBe(0);
  await page.getByRole('checkbox', { name: 'Mute' }).uncheck();
  await page.getByRole('button', { name: 'Enable audio effects' }).click();
  await expect(page.getByRole('button', { name: 'Audio effects enabled' })).toBeDisabled();
  await expect(page.getByText('Five local effects are live on Audio 1. Adjustments are audible immediately.')).toBeVisible();
  expect(await page.evaluate(() => window.__studioMediaSourceRequests)).toBe(1);
  await page.getByRole('button', { name: 'Edit EQ' }).click();
  await page.getByLabel('EQ gain').fill('6');
  const chain = page.getByLabel('Ordered effects chain');
  await chain.getByRole('listitem').first().getByRole('button', { name: 'Copy EQ' }).click();
  await page.getByRole('button', { name: 'Paste copied effect' }).click();
  await expect(chain.getByRole('listitem')).toHaveCount(6);
  const pastedEq = chain.getByRole('listitem').last();
  await expect(pastedEq.getByRole('button', { name: 'Edit EQ copy 1' })).toBeVisible();
  await pastedEq.getByLabel('EQ copy 1 gain').fill('-4');
  await expect(chain.getByRole('listitem').first().getByLabel('EQ gain')).toHaveValue('6');
  await pastedEq.getByRole('button', { name: 'Move EQ copy 1 earlier' }).click();
  await chain.getByRole('listitem').first().getByRole('button', { name: 'Duplicate EQ' }).click();
  await expect(chain.getByRole('listitem')).toHaveCount(7);
  await expect(chain.getByRole('listitem').nth(1).getByLabel('EQ copy 2 gain')).toHaveValue('6');
  expect(await page.evaluate(() => window.__studioMediaSourceRequests)).toBe(1);
  expect(await page.evaluate(() => window.__studioBiquadRequests)).toBeGreaterThanOrEqual(6);
  await chain.getByRole('listitem').first().getByRole('button', { name: 'Bypass' }).click();
  await expect(chain.getByRole('listitem').first().getByRole('button', { name: 'Bypassed' })).toBeVisible();
  await page.getByRole('button', { name: 'Automation', exact: true }).click();
  await page.getByLabel('New automation point value').fill('0.4');
  await page.getByRole('button', { name: 'Add point at playhead' }).click();
  await expect(page.getByLabel('Volume automation lane')).toBeVisible();
  await expect(page.getByLabel('Automation value point 1')).toHaveValue('0.4');
  await expect.poll(() => page.evaluate(() => window.__studioMasterTargets.at(-1))).toBeCloseTo(0.24, 5);
  await page.getByLabel('Clip trim end').fill('1');
  await page.getByLabel('Clip pitch semitones').fill('1');
  await page.getByLabel('Clip pitch cents').fill('25');
  await page.getByLabel('Clip fade in').fill('0.2');
  await page.getByLabel('Clip fade out').fill('0.2');
  await page.getByLabel('Clip fade curve').selectOption('exponential');
  await page.getByRole('checkbox', { name: 'Reverse rendered clip' }).check();
  await page.getByRole('button', { name: 'Render local clip preview' }).click();
  await expect(page.getByLabel('Rendered clip preview')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download rendered WAV' })).toHaveAttribute('download', 'veyrnox-studio-local-clip.wav');
  await expect(page.getByText(/linked pitch\/speed · exponential fades/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('F16-H2 a private link is listen-only and fails closed after revocation', async ({ page }) => {
  const token = 'A'.repeat(43);
  // App Router can cancel a duplicate Strict Mode read while the fulfilled
  // read still drives the asserted UI state below.
  page.expectedRequestFailures.add(`http://127.0.0.1:4402/api/v1/music/shared/${token}`);
  let active = true;
  await page.route(`**/api/v1/music/shared/${token}`, async (route) => {
    if (!active) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    return route.fulfill({ json: { song: {
      id: 'f6ed2d0d-8276-4fbb-9c4f-39f401a3158f',
      title: 'Listen-only midnight master',
      version_id: 'f7ed2d0d-8276-4fbb-9c4f-39f401a31580',
      version_number: 3,
      created_at: '2026-11-10T12:00:00Z',
      audio_url: `/api/v1/music/shared/${token}/asset`,
    } } });
  });
  await page.route(`**/api/v1/music/shared/${token}/asset`, (route) => route.fulfill({
    status: 200, contentType: 'audio/mpeg', body: Buffer.from('ID3'),
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/listen/${token}`);
  await expect(page.getByRole('heading', { name: 'Listen-only midnight master' })).toBeVisible();
  await expect(page.getByText('Version 3 · not indexed or published')).toBeVisible();
  await expect(page.getByText(/does not grant remix, download, ownership, or publication rights/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /download|remix|publish/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('#main').analyze();
  expect(accessibility.violations, accessibility.violations.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);

  active = false;
  const revokedUrl = `${new URL(page.url()).origin}/api/v1/music/shared/${token}`;
  page.expectedConsoleErrorUrls.add(revokedUrl);
  page.expectedRequestFailures.add(revokedUrl);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'This listening link is no longer active.' })).toBeVisible();
  await expect(page.getByText(/may have been revoked/i)).toBeVisible();
});
