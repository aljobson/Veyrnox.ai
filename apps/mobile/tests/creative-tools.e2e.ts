import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { openSignedIn } from './helpers.js';

const tools = [
  ['ai-avatar-generator', 'AI Avatar Generator', 1, false],
  ['talking-avatar', 'Talking Avatar', 2, false],
  ['ai-human-generator', 'AI Human Generator', 1, false],
  ['ai-influencer-generator', 'AI Influencer Generator', 1, false],
  ['text-to-speech', 'Text to Speech', 0, true],
  ['ai-voice-cloning', 'AI Voice Cloning', 1, false],
  ['ai-hairstyle-changer', 'AI Hairstyle Changer', 1, false],
  ['ai-hair-color-changer', 'AI Hair Color Changer', 1, false],
  ['ai-baby-generator', 'AI Baby Generator', 1, false],
  ['lip-sync', 'AI Lip Sync', 2, false],
  ['ai-talking-photo-generator', 'AI Talking Photo Generator', 2, false],
  ['singing-photo', 'Singing Photo', 2, false],
  ['avatar-dialogue', 'Avatar Dialogue', 2, false],
  ['video-dubbing', 'Video Dubbing', 2, false],
  ['talking-cartoon', 'Talking Cartoon', 2, false],
  ['talking-animals', 'Talking Animals', 2, false],
  ['ai-baby-podcast', 'AI Baby Podcast', 2, false],
  ['talking-objects', 'Talking Objects', 2, false],
  ['ai-ad-clone', 'AI Ad Clone', 1, false],
  ['product-avatar', 'Product Avatar', 2, false],
  ['product-video-generator', 'Product Video Generator', 1, false],
  ['product-image-generator', 'Product Image Generator', 1, false],
] as const;

for (const [slug, title, uploadCount, scriptUpload] of tools) {
  test(`${title} exposes its example and required uploads`, { tags: ['creative-tools', 'uploads'] }, async ({ app, device, screen }) => {
    await openSignedIn(app, screen);
    await device.openLink(`ai.veyrnox.app://features/${slug}`);

    // Native exposes both the stack title and the page title with the same text.
    await expect(screen.getByText(title).first()).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByLabel(new RegExp(`^${title} example(?: video)?$`))).toBeAttached();

    if (scriptUpload) {
      const script = screen.getByRole('button', 'Upload TXT or Markdown script');
      for (let page = 0; page < 6 && !(await script.isVisible()); page += 1) {
        await screen.swipe({ from: { x: 200, y: 740 }, to: { x: 200, y: 180 }, duration: 450 });
      }
      await expect(script).toBeVisible();
    } else {
      const files = screen.getByRole('button', { name: /^Choose (?:image|video|audio file) for / });
      for (let page = 0; page < 6 && !(await files.first().isVisible()); page += 1) {
        await screen.swipe({ from: { x: 200, y: 740 }, to: { x: 200, y: 180 }, duration: 450 });
      }
      await expect(files).toHaveCount(uploadCount);

      const libraryButtons = screen.getByRole('button', { name: /^Choose .* from your Library for / });
      await expect(libraryButtons).toHaveCount(uploadCount);

      const permission = screen.getByRole('checkbox', 'I have permission to use these sources');
      for (let page = 0; page < uploadCount + 3 && !(await permission.isVisible()); page += 1) {
        await screen.swipe({ from: { x: 200, y: 740 }, to: { x: 200, y: 180 }, duration: 450 });
      }
      await expect(permission).toBeVisible();
    }

    const review = screen.getByRole('button', 'Continue to final review');
    for (let page = 0; page < 4 && !(await review.isVisible()); page += 1) {
      await screen.swipe({ from: { x: 200, y: 740 }, to: { x: 200, y: 180 }, duration: 450 });
    }
    await expect(review).toBeVisible();
  });
}
