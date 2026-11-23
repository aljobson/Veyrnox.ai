import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { openSignedIn } from './helpers.js';

const hardPaywallEnabled = process.env.EXPO_PUBLIC_HARD_PAYWALL_ENABLED === 'true';

test('the creation prompt remains usable with a landscape keyboard', { tags: ['smoke', 'layout'], platforms: ['ios'] }, async ({ app, device, screen }) => {
  await openSignedIn(app, screen);

  try {
    await device.setOrientation('landscape-left');
    await device.openLink('ai.veyrnox.app://create/nano-banana');

    const prompt = screen.getByRole('textbox', { name: /^Prompt/ });
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await prompt.pressSequentially('Landscape keyboard smoke check.');
    await expect(prompt).toHaveValue('Landscape keyboard smoke check.');

    await device.dismissKeyboard();
    const generate = screen.getByRole('button', { name: /^Generate\./ });
    await screen.scrollUntilVisible(generate, { direction: 'down', momentum: 'slow', timeout: 15_000 });
    await expect(generate).toBeVisible();
  } finally {
    try { await device.dismissKeyboard(); } catch { /* keyboard may already be closed */ }
    await device.setOrientation('portrait');
  }
});

test('the Studio directory remains usable in landscape without project fixtures', { tags: ['smoke', 'layout', 'editor'], platforms: ['ios'] }, async ({ app, device, screen }) => {
  await openSignedIn(app, screen);

  try {
    await device.setOrientation('landscape-left');
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

test('email sign-in keeps its focused field and CTA reachable after dismissing the landscape keyboard', { tags: ['smoke', 'layout', 'auth'], platforms: ['ios'] }, async ({ app, device, screen }) => {
  try {
    await device.clearKeychain();
    await app.clearState();
    await app.open();
    const english = screen.getByRole('button', 'English');
    await expect(english).toBeVisible({ timeout: 30_000 });
    await english.tap();
    await screen.getByRole('button', 'Continue', { exact: true }).tap();
    await device.setOrientation('landscape-left');
    await device.openLink('ai.veyrnox.app://email');

    const email = screen.getByRole('textbox', 'Email');
    await expect(email).toBeVisible({ timeout: 30_000 });
    await email.pressSequentially('layout@example.test');
    await expect(email).toHaveValue('layout@example.test');
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

test('the hard paywall keeps its plan and Later escape visible in landscape without buying', {
  tags: ['smoke', 'layout', 'paywall'],
  platforms: ['ios'],
  skip: hardPaywallEnabled ? false : 'Run with EXPO_PUBLIC_HARD_PAYWALL_ENABLED=true and a fresh E2E stack.',
}, async ({ app, device, screen }) => {
  const later = screen.getByRole('button', 'Not now');

  try {
    await device.setOrientation('landscape-left');
    await openSignedIn(app, screen, later);

    await expect(screen.getByTestId('hard-paywall')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('heading', { name: /Subscribe to start creating|Try Veyrnox\.ai free|Choose your plan/ })).toBeVisible();
    await expect(later).toBeVisible();
    // Deliberately do not tap a plan, trial, restore, or purchase control.
  } finally {
    await device.setOrientation('portrait');
  }
});
