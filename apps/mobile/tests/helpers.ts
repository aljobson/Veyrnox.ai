import type { App, Screen } from 'e2e';

export async function openSignedIn(app: App, screen: Screen) {
  await app.open();
  const explore = screen.getByRole('button', 'Explore', { selected: true });
  const agreement = screen.getByRole('checkbox', 'I am 18 or older and agree to the Terms and Privacy Policy.');
  await explore.or(agreement).first().waitFor({ state: 'visible', timeout: 30_000 });
  if (await explore.isVisible()) return;

  if (!(await agreement.isChecked())) {
    await agreement.tap({ position: { x: 18, y: 22 } });
  }
  await screen.getByRole('button', 'Preview with demo data').tap();
  await explore.waitFor({ state: 'visible', timeout: 30_000 });
}
