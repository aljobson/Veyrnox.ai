import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { openFirstRun } from './helpers.js';

test('first run presents every colourful journey question and completes into the chosen workspace', { tags: ['smoke', 'onboarding'] }, async ({ app, screen }) => {
  await openFirstRun(app, screen);

  const goal = screen.getByRole('radiogroup', 'What do you want to make first?');
  await expect(goal).toBeVisible({ timeout: 30_000 });
  for (const label of ['Make an image', 'Make a video', 'Make audio', 'Edit something', 'Publish something', 'Not sure yet']) {
    await expect(screen.getByRole('radio', label)).toBeAttached();
  }
  await app.screenshot('onboarding-goal-colour-grid');
  await screen.getByRole('radio', 'Publish something').tap();

  const destination = screen.getByRole('radiogroup', 'Where will it go?');
  await expect(destination).toBeVisible({ timeout: 15_000 });
  for (const label of ['TikTok', 'Instagram Reels', 'YouTube', 'Just for me']) {
    await expect(screen.getByRole('radio', label)).toBeAttached();
  }
  await app.screenshot('onboarding-destination-colour-grid');
  await screen.getByRole('radio', 'YouTube').tap();

  const role = screen.getByRole('radiogroup', 'Which describes you best?');
  await expect(role).toBeVisible({ timeout: 15_000 });
  for (const label of ['Content creator', 'Business or marketer', 'Creative pro', 'Hobbyist, just for fun', 'Total beginner']) {
    await expect(screen.getByRole('radio', label)).toBeAttached();
  }
  await app.screenshot('onboarding-role-colour-grid');
  await screen.getByRole('radio', 'Content creator').tap();

  await expect(screen.getByText('Suggested for you')).toBeVisible({ timeout: 15_000 });
  const finish = screen.getByRole('button', 'Start creating');
  await expect(finish).toBeVisible();
  await app.screenshot('onboarding-personalised-recap');
  await finish.tap();
  await expect(screen.getByRole('button', 'Publish', { selected: true })).toBeVisible({ timeout: 30_000 });
});
