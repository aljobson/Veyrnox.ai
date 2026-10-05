import { test, expect } from '@playwright/test';
import { HAS_ACCOUNT } from './env.mjs';
import { signedIn } from './session.mjs';

const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,128}$/;

// Signed in, the create page loads the real catalog and account, and the
// Generate button sends a well-formed request. The request itself is
// answered here, so no credits are debited and no provider is called.
test('generate sends a well-formed request for the chosen model', async ({ page }) => {
    test.skip(!HAS_ACCOUNT, 'E2E_EMAIL / E2E_PASSWORD not set');
    await signedIn(page);

    let sent = null;
    await page.route('**/api/v1/generations', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        sent = route.request().postDataJSON();
        return route.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify({ error: 'insufficient_balance' }) });
    });

    const account = page.waitForResponse((r) => r.url().endsWith('/api/v1/account') && r.request().method() === 'GET');
    await page.goto('/app/create');
    expect((await account).status(), 'signed-in account read').toBe(200);

    await page.getByRole('textbox', { name: 'Prompt' }).fill('A lighthouse at dusk, slow pan');
    const generate = page.getByRole('button', { name: 'Generate' });
    await expect(generate).toBeEnabled();
    await generate.click();

    await expect(page.getByText(/Not enough credits for this generation/)).toBeVisible();
    expect(sent, 'POST /api/v1/generations was sent').not.toBeNull();
    expect(sent.model_id).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    expect(sent.idempotency_key).toMatch(IDEMPOTENCY_RE);
    expect(sent.inputs.prompt).toBe('A lighthouse at dusk, slow pan');
});
