import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { openSignedIn } from './helpers.js';

test('a runnable template opens Create with its prompt', { tags: ['templates', 'smoke'] }, async ({ app, device, screen }) => {
  await openSignedIn(app, screen);
  await device.openLink('ai.veyrnox.app://templates/mock-hero');

  const use = screen.getByRole('button', 'Use template');
  await expect(use).toBeVisible({ timeout: 30_000 });
  await expect(use).toBeEnabled();
  await use.tap();

  // The template page stays underneath in the stack, so check text only Create shows: the character count of the
  // carried prompt (54 characters).
  await expect(screen.getByText('54/30000')).toBeVisible({ timeout: 30_000 });
  await app.screenshot('template-opened-in-create');
});

// ADR 0325 / PR #1924: a template whose original community prompt is not a runnable recipe is still offered, with the
// exact community prompt shown, a Copy button and Use template.
test('copy-only templates are runnable with the exact community prompt', { tags: ['templates'] }, async ({ app, device, screen }) => {
  await openSignedIn(app, screen);
  await device.openLink('ai.veyrnox.app://templates/mock-copy-only');
  await expect(screen.getByText('Copy Only Dance')).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByText('EXACT COMMUNITY PROMPT')).toBeVisible();
  await expect(screen.getByRole('button', { name: /^Copy/ })).toBeVisible();
  await expect(screen.getByRole('button', 'Use template')).toBeVisible();
  await app.screenshot('copy-only-template-runnable');
});
