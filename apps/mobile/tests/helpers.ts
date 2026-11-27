import type { App, Screen } from 'e2e';
import type { Device } from '@e2e-dev/mobile';

const FIRST_RUN_TITLE = 'What do you want to make first?';

// Opens a clean first-run journey without using openSignedIn(), whose job is to skip onboarding. The simulator
// keychain and local app state are both cleared before a fresh launch; the mock server's demo sign-in remains the
// deterministic fallback when no session is available.
export async function openFirstRun(app: App, device: Device, screen: Screen, afterTouch?: (name: string) => Promise<void>) {
  await device.clearKeychain();
  await app.clearState();
  await app.open();
  const firstQuestion = screen.getByRole('radiogroup', FIRST_RUN_TITLE);
  const english = screen.getByRole('button', 'English');
  const agreement = screen.getByRole('checkbox', 'I am 18 or older and agree to the Terms and Privacy Policy.');
  const decline = screen.getByRole('button', 'Decline');
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await firstQuestion.isVisible()) return;
    if (await english.isVisible()) {
      await english.tap();
      await afterTouch?.('language-english');
      await screen.getByRole('button', 'Continue', { exact: true }).tap();
      await afterTouch?.('language-continue');
    } else if (await agreement.isVisible()) {
      if (!(await agreement.isChecked())) {
        await agreement.tap({ position: { x: 18, y: 22 } });
        await afterTouch?.('agreement-accepted');
      }
      await screen.getByRole('button', 'Preview with demo data').tap();
      await afterTouch?.('demo-preview');
    } else if (await decline.isVisible()) {
      await decline.tap();
      await afterTouch?.('decline-dismissed');
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('First-run journey did not reach its goal question within 60 seconds');
}

type ReadyTarget = { isVisible(): Promise<boolean> };

export async function openSignedIn(app: App, screen: Screen, alternativeReady?: ReadyTarget) {
  await app.open();
  const explore = screen.getByRole('button', 'Explore', { selected: true });
  const english = screen.getByRole('button', 'English');
  const agreement = screen.getByRole('checkbox', 'I am 18 or older and agree to the Terms and Privacy Policy.');
  const decline = screen.getByRole('button', 'Decline');
  const welcomeSkip = screen.getByRole('button', 'Skip', { exact: true });
  const startSkip = screen.getByRole('button', 'Skip for now', { exact: true });
  const deadline = Date.now() + 60_000;
  let homeSince: number | undefined;
  while (Date.now() < deadline) {
    let onboarding = true;
    if (await english.isVisible()) {
      await english.tap();
      await screen.getByRole('button', 'Continue', { exact: true }).tap();
    } else if (await agreement.isVisible()) {
      if (!(await agreement.isChecked())) await agreement.tap({ position: { x: 18, y: 22 } });
      await screen.getByRole('button', 'Preview with demo data').tap();
    } else if (await decline.isVisible()) {
      await decline.tap();
    } else if (await welcomeSkip.isVisible()) {
      await welcomeSkip.tap();
    } else if (await startSkip.isVisible()) {
      await startSkip.tap();
    } else {
      onboarding = false;
    }
    if (!onboarding && alternativeReady && await alternativeReady.isVisible()) return;
    if (!onboarding && await explore.isVisible()) {
      homeSince ??= Date.now();
      if (Date.now() - homeSince >= 2_000) return;
    } else {
      homeSince = undefined;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Onboarding did not settle on the selected Explore tab within 60 seconds');
}
