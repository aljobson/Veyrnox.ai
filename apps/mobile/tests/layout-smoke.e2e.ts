import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { LANDSCAPE_ORIENTATIONS } from '../e2e.contracts.js';
import { openSignedIn } from './helpers.js';

for (const orientation of LANDSCAPE_ORIENTATIONS) {
  test(`the creation prompt remains usable with a ${orientation} keyboard`, { tags: ['smoke', 'layout'], platforms: ['ios'] }, async ({ app, device, screen }) => {
    await openSignedIn(app, screen);

    try {
      await device.setOrientation(orientation);
      await device.openLink('ai.veyrnox.app://create/nano-banana');

      const prompt = screen.getByRole('textbox', { name: /^Prompt/ });
      await expect(prompt).toBeVisible({ timeout: 30_000 });
      await prompt.pressSequentially(`Keyboard smoke check in ${orientation}.`);
      await expect(prompt).toHaveValue(`Keyboard smoke check in ${orientation}.`);

      await device.dismissKeyboard();
      const generate = screen.getByRole('button', { name: /^Generate\./ });
      await screen.scrollUntilVisible(generate, { direction: 'down', momentum: 'slow', timeout: 15_000 });
      await expect(generate).toBeVisible();
    } finally {
      try { await device.dismissKeyboard(); } catch { /* keyboard may already be closed */ }
      await device.setOrientation('portrait');
    }
  });

  test(`the Studio directory remains usable in ${orientation} without project fixtures`, { tags: ['smoke', 'layout', 'editor'], platforms: ['ios'] }, async ({ app, device, screen }) => {
    await openSignedIn(app, screen);

    try {
      await device.setOrientation(orientation);
      await device.openLink('ai.veyrnox.app://editor');

      // Project rows depend on seeded account data. The directory and editor entry
      // are the deterministic contract for a clean or populated Studio account.
      await expect(screen.getByRole('heading', 'Studio')).toBeVisible({ timeout: 30_000 });
      await expect(screen.getByRole('button', 'Beats')).toBeVisible();
      await expect(screen.getByRole('button', 'Professional')).toBeVisible();
    } finally {
      await device.setOrientation('portrait');
    }
  });

  test(`email sign-in keeps its focused field and CTA reachable after dismissing the ${orientation} keyboard`, { tags: ['smoke', 'layout', 'auth'], platforms: ['ios'] }, async ({ app, device, screen }) => {
    try {
      await device.clearKeychain();
      await app.clearState();
      await app.open();
      const english = screen.getByRole('button', 'English');
      await expect(english).toBeVisible({ timeout: 30_000 });
      await english.tap();
      await screen.getByRole('button', 'Continue', { exact: true }).tap();
      await device.setOrientation(orientation);
      await device.openLink('ai.veyrnox.app://email');

      const email = screen.getByRole('textbox', 'Email');
      await expect(email).toBeVisible({ timeout: 30_000 });
      await email.pressSequentially(`layout-${orientation}@example.test`);
      await expect(email).toHaveValue(`layout-${orientation}@example.test`);
      await device.dismissKeyboard();

      const signIn = screen.getByRole('button', 'Sign in and start creating');
      await screen.scrollUntilVisible(signIn, { direction: 'down', momentum: 'slow', timeout: 15_000 });
      await expect(signIn).toBeVisible();
    } finally {
      try { await device.dismissKeyboard(); } catch { /* keyboard may already be closed */ }
      await device.setOrientation('portrait');
      await openSignedIn(app, screen);
    }
  });
}
