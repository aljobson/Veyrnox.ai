import { test, expect } from '@playwright/test';
import { HAS_ACCOUNT } from './env.mjs';
import { signedIn } from './session.mjs';

const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_e2e';

// Signed in, the credits page shows the real balance and packs, needs the
// supply consent, and sends a well-formed Top-up. The Top-up and the Stripe
// page are answered here, so no pending Top-up is written to staging.
test('buying a pack needs consent and opens Stripe checkout', async ({ page }) => {
    test.skip(!HAS_ACCOUNT, 'E2E_EMAIL / E2E_PASSWORD not set');
    await signedIn(page);

    let sent = null;
    await page.route('**/api/v1/top-ups', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        sent = route.request().postDataJSON();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checkout_url: CHECKOUT_URL }) });
    });
    await page.route('https://checkout.stripe.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Stripe (e2e)</title>' }));

    const balance = page.waitForResponse((r) => r.url().endsWith('/api/v1/balance'));
    const packs = page.waitForResponse((r) => r.url().endsWith('/api/v1/credit-packs'));
    await page.goto('/app/credits');
    expect((await balance).status(), 'signed-in balance read').toBe(200);
    expect((await packs).status(), 'credit packs read').toBe(200);

    const firstPack = page.getByRole('group', { name: 'Choose a credit pack' }).getByRole('radio').first();
    const packId = await firstPack.getAttribute('value');
    await firstPack.check({ force: true });
    const buy = page.getByRole('button', { name: 'Buy credits' });
    await expect(buy).toBeDisabled();

    await page.getByRole('checkbox', { name: /credits added to my account straight away/ }).check();
    await expect(buy).toBeEnabled();
    await buy.click();

    await page.waitForURL(CHECKOUT_URL);
    expect(sent, 'POST /api/v1/top-ups was sent').not.toBeNull();
    expect(sent.pack_id).toBe(packId);
    expect(sent.consent).toBe(true);
    expect(sent.consent_version).toBe('supply-consent-v1');
    expect(sent.idempotency_key).toMatch(/^[A-Za-z0-9._-]{8,128}$/);
});
