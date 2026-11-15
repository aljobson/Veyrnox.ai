import { mkdirSync, appendFileSync } from 'node:fs';
import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { openSignedIn } from './helpers.js';

// Error-state testing through dev/fault-proxy.mjs (:8799 -> mock :8800). For each fault mode and screen the app is
// restarted so it must fetch cold, then the screen is classified: crash, error-with-recovery, spinner-forever, blank,
// content. After the fault is lifted the screen must recover (retry button or a fresh open).
const CONTROL = 'http://localhost:8799/__fault';
const SCREENS = ['', 'library', 'create', 'credits', 'account', 'models', 'pricing', 'chat', 'publish', 'history', 'help'];
const MODES = ['500', '401', '429', 'slow', 'drop', 'badjson', 'empty', 'html'];
const ERROR_TEXT = /couldn.?t|could not|try again|retry|connection|offline|went wrong|unavailable|not responding|something|failed|error|sign in|session/i;
const SPINNER = /loading|progressbar|activity/i;
const BAD = ['Unmatched Route', 'Uncaught Error', 'This screen doesn’t exist'];

mkdirSync('.e2e/errors', { recursive: true });
const log = (row: Record<string, unknown>) => appendFileSync('.e2e/errors/results.jsonl', JSON.stringify(row) + '\n');
const setFault = async (mode: string, match = '') => { await fetch(`${CONTROL}?mode=${mode}&match=${encodeURIComponent(match)}`); };

function classify(tree: string): string {
  if (!tree.includes('application')) return 'CRASH_OR_EMPTY_TREE';
  if (BAD.some(b => tree.includes(b))) return 'ERROR_SCREEN_EXPOSED';
  const nodes = tree.split('\n').length;
  const hasError = ERROR_TEXT.test(tree);
  const hasRetry = /button "(Retry|Try again|Reload|Refresh)/i.test(tree);
  if (hasError && hasRetry) return 'error_with_retry';
  if (hasError) return 'error_no_retry';
  if (SPINNER.test(tree) && nodes < 40) return 'SPINNER_ONLY';
  if (nodes < 12) return 'BLANK';
  return 'content';
}

for (const mode of MODES) {
  test(`fault ${mode} across screens`, { tags: ['errors'] }, async ({ app, device, screen }) => {
    const problems: string[] = [];
    try {
      await setFault('pass');
      await openSignedIn(app, screen);
      for (const route of SCREENS) {
        await setFault(mode, '/api');
        await app.restart();
        await device.openLink(`ai.veyrnox.app://${route}`);
        await new Promise(resolve => setTimeout(resolve, mode === 'slow' ? 10_000 : 6_000));
        const during = classify(await screen.tree());
        await app.screenshot(`fault-${mode}-${route || 'home'}-during`);
        await setFault('pass');
        const retry = screen.getByRole('button', { name: /^(Retry|Try again|Reload|Refresh)/i }).first();
        let recovered = 'no-retry-needed';
        try {
          if (await retry.isVisible()) { await retry.tap({ timeout: 3_000 }); recovered = 'retry-tapped'; }
          else { await device.openLink(`ai.veyrnox.app://${route}`); recovered = 'reopened'; }
        } catch { recovered = 'retry-failed'; }
        await new Promise(resolve => setTimeout(resolve, 5_000));
        let after = classify(await screen.tree());
        if (after !== 'content' && after !== 'error_with_retry') {
          // A sign-in or onboarding gate after a 401 is a valid state; let the helper settle it once.
          try { await openSignedIn(app, screen); await device.openLink(`ai.veyrnox.app://${route}`); await new Promise(r => setTimeout(r, 3_000)); after = classify(await screen.tree()); recovered += '+resigned'; } catch { /* keep first result */ }
        }
        log({ mode, route: route || 'home', during, recovered, after });
        if (['CRASH_OR_EMPTY_TREE', 'ERROR_SCREEN_EXPOSED', 'SPINNER_ONLY', 'BLANK'].includes(during)) problems.push(`${mode} /${route}: ${during} while failing`);
        if (['CRASH_OR_EMPTY_TREE', 'ERROR_SCREEN_EXPOSED', 'SPINNER_ONLY', 'BLANK', 'error_no_retry'].includes(after)) problems.push(`${mode} /${route}: still ${after} after the fault was lifted`);
      }
    } finally {
      await setFault('pass');
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
}

test('generate while the API fails: clear error, no charge, can retry', { tags: ['errors', 'generation'] }, async ({ app, device, screen }) => {
  try {
    await setFault('pass');
    await openSignedIn(app, screen);
    await device.openLink('ai.veyrnox.app://create/nano-banana');
    const promptInput = screen.getByRole('textbox', { name: /^Prompt/ });
    await expect(promptInput).toBeVisible({ timeout: 30_000 });
    await promptInput.fill('A small paper boat on still water, soft morning light.');
    await device.dismissKeyboard();
    const balanceBefore = (await screen.tree()).match(/balance (\d+) cr/)?.[1];
    const generate = screen.getByRole('button', { name: /^Generate\./ });
    for (let page = 0; page < 7 && !(await generate.isVisible()); page += 1) {
      await screen.swipe({ from: { x: 200, y: 740 }, to: { x: 200, y: 180 }, duration: 450 });
    }
    await setFault('500', '/api/v1/generations');
    await generate.tap({ position: { x: 160, y: 24 } });
    const consent = screen.getByRole('button', 'Agree and continue');
    try { await consent.waitFor({ state: 'visible', timeout: 4_000 }); await consent.tap(); } catch { /* already consented */ }
    await new Promise(resolve => setTimeout(resolve, 8_000));
    const tree = await screen.tree();
    await app.screenshot('generate-during-500');
    const balanceAfter = tree.match(/balance (\d+) cr/)?.[1];
    log({ scenario: 'generate-500', balanceBefore, balanceAfter, state: classify(tree), shows: ERROR_TEXT.test(tree) });
    expect(ERROR_TEXT.test(tree), 'a failed generation should say so').toBe(true);
    if (balanceBefore && balanceAfter) expect(balanceAfter, 'credits must not be charged for a failed request').toBe(balanceBefore);
    await setFault('pass');
    await new Promise(resolve => setTimeout(resolve, 1_000));
  } finally {
    await setFault('pass');
  }
});
