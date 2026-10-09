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

    // The form's own check: the browser accepts this address, the form does not.
    const status = dialog.getByRole('status');
    await password.fill('long-enough-password');
    await email.fill('e2e@never-sent');
    await submit.click();
    await expect(status).toContainText('Enter a valid email address.');

    // A valid form still needs the Turnstile token (ADR-0026). The words
    // depend on whether the widget has reported a failure by now, as it does
    // on a hostname its site key does not list. All of them name the check.
    await email.fill('e2e-never-sent@example.invalid');
    await submit.click();
    await expect(status).toContainText('security check');

    expect(signupCalls).toBe(0);
});
