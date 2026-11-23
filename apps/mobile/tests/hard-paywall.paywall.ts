import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { LANDSCAPE_ORIENTATIONS } from '../e2e.contracts.js';
import { openSignedIn } from './helpers.js';

for (const orientation of LANDSCAPE_ORIENTATIONS) {
  test(`the hard paywall keeps its plan and Later escape visible in ${orientation} without buying`, {
    tags: ['smoke', 'layout', 'paywall'],
    platforms: ['ios'],
  }, async ({ app, device, screen }) => {
    const paywall = screen.getByTestId('hard-paywall');
    const later = screen.getByRole('button', 'Not now');

    try {
      await device.setOrientation(orientation);
      await openSignedIn(app, screen, paywall);

      await expect(paywall).toBeVisible({ timeout: 30_000 });
      await expect(screen.getByRole('heading', { name: /Subscribe to start creating|Try Veyrnox\.ai free|Choose your plan/ })).toBeVisible();
      await expect(later).toBeVisible();
      // Deliberately do not tap a plan, trial, restore, or purchase control.
    } finally {
      await device.setOrientation('portrait');
    }
  });
}
