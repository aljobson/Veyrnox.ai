import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { openSignedIn } from './helpers.js';

test('the native Editor is available and can open an existing project', { tags: ['smoke', 'editor'] }, async ({ app, device, screen }) => {
  await openSignedIn(app, screen);
  await device.openLink('ai.veyrnox.app://editor');

  await expect(screen.getByRole('button', 'Editor', { selected: true })).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByRole('button', 'New edit')).toBeVisible();

  const projects = screen.getByRole('button', { name: /^Open (?!menu$)/ });
  expect(await projects.count(), 'Editor should expose at least one saved project in the QA account').toBeGreaterThan(0);
  await projects.first().tap();
  await expect(screen.getByTestId('editor-tool-rail')).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByRole('button', 'Media')).toBeAttached();
  await expect(screen.getByRole('button', 'Audio')).toBeAttached();
  await expect(screen.getByRole('button', 'Generate')).toBeAttached();
  await expect(screen.getByRole('button', 'Templates')).toBeAttached();
  await expect(screen.getByRole('button', 'Elements')).toBeAttached();
  await expect(screen.getByRole('button', 'Text')).toBeAttached();
});
