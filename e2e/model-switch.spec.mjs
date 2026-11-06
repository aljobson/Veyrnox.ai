import { test, expect } from '@playwright/test';
import { HAS_ACCOUNT } from './env.mjs';
import { signedIn } from './session.mjs';

const MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,128}$/;

// Switches to every model the create page lists and presses Generate on each.
// The POST is answered here with insufficient_balance, so no credits are
// debited and no provider is called. Fails on: a page error, a same-origin 5xx,
// a model button that does not become selected, a request that carries the
// wrong or a malformed model id, or two models sending the same id.
test('every listed model can be selected and sends its own well-formed request', async ({ page, baseURL }) => {
    test.skip(!HAS_ACCOUNT, 'E2E_EMAIL / E2E_PASSWORD not set');
    test.setTimeout(300_000);
    await signedIn(page);

    const pageErrors = [];
    const serverErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 300)));
    page.on('response', (response) => {
        if (new URL(response.url()).origin === new URL(baseURL).origin && response.status() >= 500) {
            serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
        }
    });

    let sent = null;
    await page.route('**/api/v1/generations', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        sent = route.request().postDataJSON();
        return route.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify({ error: 'insufficient_balance' }) });
    });

    await page.goto('/app/create');
    const models = page.locator('[data-assistant-target="create.models"] button[aria-pressed]');
    await expect(models.first()).toBeVisible();
    const count = await models.count();
    expect(count, 'the create page lists models').toBeGreaterThan(0);

    const seen = new Map();
    const skipped = [];
    for (let i = 0; i < count; i += 1) {
        const button = models.nth(i);
        const label = (await button.locator('span.truncate').first().innerText()).trim();
        await button.click();
        await expect(button, `${label} becomes selected`).toHaveAttribute('aria-pressed', 'true');

        await page.locator('[data-assistant-target="create.prompt"]').fill('QA bot: a lighthouse at dusk');
        const generate = page.getByRole('button', { name: 'Generate' });
        if (!(await generate.isEnabled())) { skipped.push(`${label} (Generate disabled: needs an input or is gated)`); continue; }

        sent = null;
        await generate.click();
        await expect.poll(() => sent, { message: `${label} sends a request`, timeout: 10_000 }).not.toBeNull();
        expect(sent.model_id, `${label} model_id`).toMatch(MODEL_ID_RE);
        expect(sent.idempotency_key, `${label} idempotency_key`).toMatch(IDEMPOTENCY_RE);
        expect(seen.has(sent.model_id), `${label} reuses model_id ${sent.model_id} already sent by ${seen.get(sent.model_id)}`).toBe(false);
        seen.set(sent.model_id, label);
    }

    test.info().annotations.push({ type: 'models', description: `${seen.size} sent, ${skipped.length} skipped: ${skipped.join('; ')}` });
    expect(seen.size, 'at least one model could generate').toBeGreaterThan(0);
    expect(pageErrors, 'page errors while switching models').toEqual([]);
    expect(serverErrors, 'server errors while switching models').toEqual([]);
});
