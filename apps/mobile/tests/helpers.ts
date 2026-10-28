import type { App, Screen } from 'e2e';

export async function openSignedIn(app: App, screen: Screen) {
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
