import { test, expect, installProductFixtures } from './fixtures/authenticated-product.mjs';

// Keys pressed inside an editor dialog belong to the dialog: Escape closes it (and focus returns to its trigger), and
// Delete/Backspace never reach the timeline behind it. Outside a dialog Escape still clears the selection.
test('Editor dialogs own their keys: Escape closes the shortcuts dialog and Delete leaves the clip alone', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The keyboard shortcuts guide is a desktop feature');
  const fixture = await installProductFixtures(page, {});
  const response = await fixture.open('/app/editor');
  expect(response.status(), 'The owned local server must enable the editor rollout for these fixtures').toBe(200);
  await expect(page.getByTestId('editor-workspace')).toBeVisible();
  await page.getByTestId('editor-import').setInputFiles('tests/fixtures/editor-render-360p30.mp4');
  const clip = page.getByRole('button', { name: /^editor-render-360p30\.mp4 / });
  await expect(clip).toBeVisible({ timeout: 30_000 });
  await clip.click();
  const split = page.getByRole('button', { name: 'Split', exact: true });
  await expect(split, 'the clip is selected').toBeEnabled();

  const trigger = page.getByRole('button', { name: 'Keyboard shortcuts (?)' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  await expect(clip, 'Delete inside the dialog does not delete the clip').toHaveCount(1);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger, 'focus returns to the trigger').toBeFocused();
  await expect(split, 'Escape in the dialog does not clear the selection').toBeEnabled();

  await clip.click();
  await page.keyboard.press('Escape');
  await expect(split, 'Escape outside a dialog still clears the selection').toBeDisabled();

  await clip.click();
  await page.getByTestId('editor-export').first().click();
  await expect(page.getByRole('dialog', { name: 'Export video' })).toBeVisible();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Export video' })).toHaveCount(0);
  await expect(clip, 'Delete inside the export dialog does not delete the clip').toHaveCount(1);
});
