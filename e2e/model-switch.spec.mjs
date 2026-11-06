import { test, expect } from '@playwright/test';
import { HAS_ACCOUNT } from './env.mjs';
import { signedIn } from './session.mjs';

const MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,128}$/;

// Switches to every model the create page lists (all goals: image, video and
// audio) and presses Generate on each. The POST is answered here with
// insufficient_balance, so no credits are debited and no provider is called.
// Fails on: a page error, a same-origin 5xx, a model button that does not become
// selected, or a request whose model_id is not the one the picker has selected.
test('every listed model can be selected and sends its own request', async ({ page, baseURL }) => {
    test.skip(!HAS_ACCOUNT, 'E2E_EMAIL / E2E_PASSWORD not set');
    test.setTimeout(300_000);
    await signedIn(page);

    const origin = new URL(baseURL).origin;
    const pageErrors = [];
    const serverErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 300)));
    page.on('response', (response) => {
        const url = new URL(response.url());
        if (url.origin === origin && response.status() >= 500) serverErrors.push(`${response.status()} ${url.pathname}`);
    });

    let sent = null;
    await page.route('**/api/v1/generations', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        sent = route.request().postDataJSON();
        return route.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify({ error: 'insufficient_balance' }) });
    });

    // The picker first renders a fallback list; wait for the live catalog and the
    // account before taking a snapshot of it.
    const isRead = (path) => (r) => new URL(r.url()).origin === origin && new URL(r.url()).pathname === path && r.request().method() === 'GET';
    const catalog = page.waitForResponse(isRead('/api/catalog'));
    const account = page.waitForResponse(isRead('/api/v1/account'));
    await page.goto('/app/create');
    expect((await catalog).status(), 'live catalog read').toBe(200);
    expect((await account).status(), 'signed-in account read').toBe(200);

    // The page opens on the image goal; "all" lists every model.
    const allGoal = page.getByTestId('create-goal-all');
    await allGoal.click();
    await expect(allGoal).toHaveAttribute('aria-pressed', 'true');

    const models = page.locator('[data-assistant-target="create.models"] button[aria-pressed]');
    const picker = page.locator('#studio-model');
    await expect(models.first()).toBeVisible();
    // The hidden <select> renders the same list from the same catalog: it is the source of each model's id.
    await expect.poll(async () => (await picker.locator('option').count()) === (await models.count()), { message: 'button list and select list settle to the same size' }).toBe(true);
    const ids = await picker.locator('option').evaluateAll((options) => options.map((o) => o.value));
    expect(ids.length, 'the create page lists models').toBeGreaterThan(0);

    const generate = page.locator('[data-assistant-target="create.generate"]');
    const seen = new Map();
    const skipped = [];
    for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i];
        const button = models.nth(i);
        const label = (await button.locator('span.truncate').first().innerText()).trim();
        await button.click();
        await expect(button, `${label} becomes selected`).toHaveAttribute('aria-pressed', 'true');
        await expect(picker, `${label} is the selected model`).toHaveValue(id);

        await page.locator('[data-assistant-target="create.prompt"]').fill('QA bot: a lighthouse at dusk');
        // Gated, source-required and consent-gated models leave Generate disabled: note them, do not fail.
        const enabled = await expect(generate).toBeEnabled({ timeout: 3_000 }).then(() => true, () => false);
        if (!enabled) { skipped.push(`${label} (${id}): Generate disabled`); continue; }

        sent = null;
        await generate.click();
        await expect.poll(() => sent, { message: `${label} sends a request`, timeout: 10_000 }).not.toBeNull();
        expect(sent.model_id, `${label} sends the selected model`).toBe(id);
        expect(sent.model_id, `${label} model_id`).toMatch(MODEL_ID_RE);
        expect(sent.idempotency_key, `${label} idempotency_key`).toMatch(IDEMPOTENCY_RE);
        expect(seen.has(id), `${label} sent a model_id already sent by ${seen.get(id)}`).toBe(false);
        seen.set(id, label);
    }

    test.info().annotations.push({ type: 'models', description: `${seen.size} sent, ${skipped.length} skipped: ${skipped.join('; ')}` });
    expect(seen.size, 'at least one model could generate').toBeGreaterThan(0);
    expect(pageErrors, 'page errors while switching models').toEqual([]);
    expect(serverErrors, 'server errors while switching models').toEqual([]);
});
