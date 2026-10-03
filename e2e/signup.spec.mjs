import { test, expect } from '@playwright/test';

// The sign-up form, up to the security check. No account is ever created:
// any call to Auth's signup endpoint is aborted and fails the test.
test('sign-up validates input and will not submit without the security check', async ({ page }) => {
    let signupCalls = 0;
    await page.route('**/auth/v1/signup**', (route) => { signupCalls += 1; return route.abort(); });

    await page.goto('/?auth=sign_up');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Create your account')).toBeVisible();

    const email = dialog.getByLabel(/email/i);
    const password = dialog.getByLabel(/^password/i);
    const submit = dialog.getByRole('button', { name: 'Create account' });

    // The browser's own validation stops a malformed address or a short
    // password before the form's handler runs.
    await email.fill('not-an-email');
    expect(await email.evaluate((el) => el.validity.typeMismatch)).toBe(true);
    expect(await password.getAttribute('minlength')).toBe('8');

    // A valid form still needs the Turnstile token (ADR-0026).
    await email.fill('e2e-never-sent@example.invalid');
    await password.fill('long-enough-password');
    await submit.click();
    await expect(dialog.getByText('Complete the security check first.')).toBeVisible();

    expect(signupCalls).toBe(0);
});
