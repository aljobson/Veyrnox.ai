import { test, expect } from './fixtures/authenticated-product.mjs';
import { installNarrationFixtures } from './fixtures/narration-product.mjs';

const SCRIPT = 'This is a private quality assurance test.';
async function draft(page, script = SCRIPT) {
  await page.getByLabel('BRIEF', { exact: true }).fill('A blue sphere moves slowly on a private studio table.');
  await page.getByLabel('Exact narration (optional)', { exact: true }).fill(script);
}
test('exact narration is fully previewed and one approval carries the same script at 165 credits', async ({ page }) => {
  const fixture = await installNarrationFixtures(page); await fixture.open('/app/video-agent');
  await expect(page.getByText(/Brief-only audio is generated/)).toBeVisible();
  await draft(page); await page.getByRole('button', { name: 'Make a plan', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Approved exact narration', exact: true })).toContainText(SCRIPT);
  const approve = page.getByRole('button', { name: 'Approve and make it · 165 cr', exact: true });
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
    await page.getByRole('button', { name: 'Make a plan', exact: true }).click();
    await expect.poll(() => fixture.plans.length).toBe(1);
    await page.getByLabel('Exact narration (optional)', { exact: true }).fill('New exact narration.'); release();
    await expect(page.getByRole('button', { name: 'Make a plan', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: /Approve and make it/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Make a plan', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Approved exact narration' })).toContainText('New exact narration.');
    await page.getByLabel('Exact narration (optional)', { exact: true }).fill('Changed after planning.');
    await expect(page.getByRole('button', { name: /Approve and make it/ })).toHaveCount(0);
    expect(fixture.generations).toHaveLength(0);
  } finally { release(); }
});
test('unsupported exact narration fails without a paid approval and native mode remains available', async ({ page }) => {
  const fixture = await installNarrationFixtures(page, { supported: false }); await fixture.open('/app/video-agent');
  await draft(page); await page.getByRole('button', { name: 'Make a plan', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /^Exact narration is unavailable/ })).toHaveText('Exact narration is unavailable right now. Nothing was charged. Keep your words and try planning again later.');
  await expect(page.getByRole('button', { name: /Approve and make it/ })).toHaveCount(0);
  await page.getByLabel('Exact narration (optional)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Make a plan', exact: true }).click();
  await expect(page.getByRole('button', { name: /Approve and make it/ })).toBeEnabled();
  expect(Object.hasOwn(fixture.plans[1], 'narration_text')).toBe(false);
  expect(fixture.generations).toHaveLength(0); expect(fixture.state.balance).toBe(1000);
});
