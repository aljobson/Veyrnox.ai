import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { openSignedIn } from './helpers.js';

const prompt = 'Museum-grade editorial photograph of a hand-blown obsidian perfume bottle suspended above a honed black-basalt plinth. Narrow cyan rim light traces the glass; a warm tungsten key reveals amber liquid and micro-bubbles. 85mm macro lens, f/5.6, eye-level three-quarter view, disciplined negative space, deep charcoal seamless backdrop, physically accurate reflections, subtle film grain, premium colour grade. No text, logos, hands, duplicate objects, warped glass, bloom, or watermark.';
const jobLabel = prompt.slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('creates an image, renders the result, and records it in Library', { tags: ['generation', 'smoke'] }, async ({ app, device, screen }) => {
  await openSignedIn(app, screen);
  await device.openLink('ai.veyrnox.app://create/nano-banana');

  // iOS combines the TextInput label and placeholder into its accessible name.
  const promptInput = screen.getByRole('textbox', { name: /^Prompt/ });
  await expect(promptInput).toBeVisible({ timeout: 30_000 });
  await promptInput.fill(prompt);
  await device.dismissKeyboard();

  const generate = screen.getByRole('button', { name: /^Generate\./ });
  for (let page = 0; page < 7 && !(await generate.isVisible()); page += 1) {
    await screen.swipe({ from: { x: 200, y: 740 }, to: { x: 200, y: 180 }, duration: 450 });
  }
  await expect(generate).toBeVisible();
  await expect(generate).toBeEnabled();
  await app.screenshot('generation-ready-to-submit');
  await generate.tap({ position: { x: 160, y: 24 } });

  const consent = screen.getByRole('button', 'Agree and continue');
  const started = consent
    .or(screen.getByText(/Queued|Running/))
    .or(screen.getByRole('image', 'Your creation'));
  await started.waitFor({ state: 'visible', timeout: 3_000 }).catch(async () => {
    // A still-focused multiline field can consume the first iOS tap after its keyboard closes.
    // Retry only while the unchanged, enabled Generate control is still on screen.
    if (await generate.isVisible()) await generate.tap({ position: { x: 160, y: 24 } });
  });
  if (await consent.isVisible()) await consent.tap();

  await expect(screen.getByRole('image', 'Your creation')).toBeVisible({ timeout: 30_000 });
  await app.screenshot('generation-rendered-output');

  await device.openLink('ai.veyrnox.app://library');
  const libraryEntry = screen.getByRole('button', { name: new RegExp(`^${jobLabel}, Ready,`) });
  await expect(libraryEntry).toBeVisible({ timeout: 30_000 });
  await app.screenshot('generation-library-proof');
});
