import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { NAVIGATION_MENU_LABELS } from '../e2e.contracts.js';
import { openSignedIn } from './helpers.js';

test('the signed-in shell exposes every primary workspace', { tags: ['smoke', 'navigation'] }, async ({ app, device, screen }) => {
  await openSignedIn(app, screen);
  await expect(screen.getByRole('button', 'Explore', { selected: true })).toBeVisible();

  for (const [tab, route] of [['Create', 'create'], ['Editor', 'editor'], ['Library', 'library'], ['Publish', 'publish']] as const) {
    await device.openLink(`ai.veyrnox.app://${route}`);
    await expect(screen.getByRole('button', tab, { selected: true })).toBeVisible();
  }
});

test('the menu exposes tools, assets and Social Cinema', { tags: ['smoke', 'navigation'] }, async ({ app, screen }) => {
  await openSignedIn(app, screen);
  await screen.getByRole('button', 'Open menu').tap();

  // The drawer is the production navigation contract. Retired Face Filters and build-disabled Film Studio stay out;
  // Editor and Smart Cut are the supported editing entries.
  for (const destination of NAVIGATION_MENU_LABELS) {
    await expect(screen.getByRole('link', destination)).toBeAttached();
  }

  const cinema = screen.getByRole('link', 'Social Cinema');
  await screen.scrollUntilVisible(cinema, { direction: 'down', momentum: 'slow' });
  await expect(cinema).toBeVisible();
  await cinema.tap();
  await expect(screen.getByText('Social Cinema')).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByText('Continue watching')).toBeVisible({ timeout: 30_000 });
});

test('the simplified Creative Tools view starts with avatars and renders the complete catalogue', { tags: ['smoke', 'creative-tools'] }, async ({ app, device, screen }) => {
  await openSignedIn(app, screen);
  await device.openLink('ai.veyrnox.app://features');

  await expect(screen.getByText('Avatars')).toBeVisible();
  await expect(screen.getByRole('button', { name: /AI Avatar Generator/ })).toBeVisible();
  await expect(screen.getByRole('button', { name: /Talking Avatar/ })).toBeAttached();

  const last = screen.getByRole('button', { name: /Product Image Generator/ });
  // The catalogue is a virtualized React Native list. Raw drags exercise the
  // same gesture path as a user and keep working after off-screen rows unmount.
  for (let page = 0; page < 12 && !(await last.isVisible()); page += 1) {
    await screen.swipe({ from: { x: 200, y: 740 }, to: { x: 200, y: 180 }, duration: 450 });
  }
  await expect(last).toBeVisible();
});
