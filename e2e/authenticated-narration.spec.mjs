import { test, expect } from './fixtures/authenticated-product.mjs';
import { installNarrationFixtures } from './fixtures/narration-product.mjs';

const SCRIPT = 'This is a private quality assurance test.';
async function draft(page, script = SCRIPT) {
  await page.getByTestId('agent-brief').fill('A blue sphere moves slowly on a private studio table.');
  await page.getByTestId('agent-narration').fill(script);
}
test('exact narration is fully previewed and one approval carries the same script at 165 credits', async ({ page }) => {
  const fixture = await installNarrationFixtures(page); await fixture.open('/app/video-agent');
  const help = page.getByTestId('agent-narration-help');
  await expect(help).toHaveCount(1);
  await expect(help).toBeVisible();
  await draft(page); await page.getByTestId('agent-plan').click();
  await expect(page.getByTestId('agent-narration-preview')).toContainText(SCRIPT);
  const approve = page.getByTestId('agent-approve');
  await expect(approve).toBeEnabled(); await approve.dblclick();
  await expect.poll(() => fixture.generations.length).toBe(1);
  expect(fixture.plans[0].narration_text).toBe(SCRIPT);
  expect(fixture.generations[0].inputs.narration_text).toBe(SCRIPT);
  expect(fixture.state.balance).toBe(835);
});
test('editing a script discards its approval and ignores a late obsolete plan response', async ({ page }) => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const fixture = await installNarrationFixtures(page, { beforePlan: (_body, index) => index === 1 ? pending : undefined });
  try {
    await fixture.open('/app/video-agent'); await draft(page);
    await page.getByTestId('agent-plan').click();
    await expect.poll(() => fixture.plans.length).toBe(1);
    await page.getByTestId('agent-narration').fill('New exact narration.'); release();
    await expect(page.getByTestId('agent-plan')).toBeEnabled();
    await expect(page.getByTestId('agent-approve')).toHaveCount(0);
    await page.getByTestId('agent-plan').click();
    await expect(page.getByTestId('agent-narration-preview')).toContainText('New exact narration.');
    await page.getByTestId('agent-narration').fill('Changed after planning.');
    await expect(page.getByTestId('agent-approve')).toHaveCount(0);
    expect(fixture.generations).toHaveLength(0);
  } finally { release(); }
});
test('unsupported exact narration fails without a paid approval and native mode remains available', async ({ page }) => {
  const fixture = await installNarrationFixtures(page, { supported: false }); await fixture.open('/app/video-agent');
  await draft(page); await page.getByTestId('agent-plan').click();
  await expect(page.getByTestId('agent-error')).toHaveText('Exact narration is unavailable right now. Nothing was charged. Keep your words and try planning again later.');
  await expect(page.getByTestId('agent-approve')).toHaveCount(0);
  await page.getByTestId('agent-narration').fill('');
  await page.getByTestId('agent-plan').click();
  await expect(page.getByTestId('agent-approve')).toBeEnabled();
  expect(Object.hasOwn(fixture.plans[1], 'narration_text')).toBe(false);
  expect(fixture.generations).toHaveLength(0); expect(fixture.state.balance).toBe(1000);
});
