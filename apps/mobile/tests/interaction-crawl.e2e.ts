import { mkdirSync, appendFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { openSignedIn } from './helpers.js';

// Interaction crawl: for every static screen, read the accessibility tree, tap each control once (up to MAX_PER_ROUTE),
// and record whether the app stayed healthy. Runs against the dev mock server only. It skips controls that destroy
// data, spend money, sign the account out, or open the system photo/camera pickers.
const ROUTES: string[] = JSON.parse(readFileSync(new URL('./crawl-routes.json', import.meta.url), 'utf8'));
const MAX_PER_ROUTE = 14;
const ONLY = process.env.CRAWL_ONLY ? new RegExp(process.env.CRAWL_ONLY) : null;

const SKIP = /delete|erase|remove account|sign out|log out|logout|disconnect|unlink|reset|buy|purchase|subscribe|checkout|pay |upgrade|restore|photo|video library|camera|picker|attach|upload from|choose file|files$|^files|open menu|^back$|\(tabs\)|backbutton|vertical scroll|horizontal scroll|debugger/i;
const BAD = ['Unmatched Route', 'Something went wrong', 'Uncaught Error', 'This screen doesn’t exist', "This screen doesn't exist"];
const ROLES = ['button', 'link', 'switch', 'checkbox', 'tab', 'radio', 'menuitem'];

mkdirSync('.e2e/crawl', { recursive: true });
const log = (row: Record<string, unknown>) => appendFileSync('.e2e/crawl/results.jsonl', JSON.stringify(row) + '\n');

function controlsFrom(tree: string): Array<{ role: string; name: string; disabled: boolean }> {
  const seen = new Set<string>();
  const out: Array<{ role: string; name: string; disabled: boolean }> = [];
  for (const line of tree.split('\n')) {
    const m = line.match(/^\s*#\S+\s+(\w+)\s+"([^"]*)"(.*)$/);
    if (!m) continue;
    const [, role, name, rest] = m;
    if (!ROLES.includes(role) || !name.trim()) continue;
    const key = `${role}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role, name, disabled: /\[disabled\]/.test(rest) });
  }
  return out;
}

for (const route of ROUTES) {
  if (ONLY && !ONLY.test(route)) continue;
  test(`crawl /${route}`, { tags: ['crawl'] }, async ({ app, device, screen }) => {
    await openSignedIn(app, screen);
    const open = async () => {
      await device.openLink(`ai.veyrnox.app://${route}`);
      await new Promise(resolve => setTimeout(resolve, 1_500));
    };
    await open();
    const failures: string[] = [];
    const initial = controlsFrom(await screen.tree());
    log({ route, event: 'controls', count: initial.length, names: initial.map(c => `${c.role}:${c.name}`) });

    let tapped = 0;
    for (const control of initial) {
      if (tapped >= MAX_PER_ROUTE) break;
      if (SKIP.test(control.name)) { log({ route, event: 'skipped', control: control.name }); continue; }
      if (control.disabled) { log({ route, event: 'disabled', control: control.name }); continue; }
      const target = screen.getByRole(control.role as never, control.name, { exact: true }).first();
      tapped += 1;
      let note = 'ok';
      try {
        await target.tap({ timeout: 4_000 });
        await new Promise(resolve => setTimeout(resolve, 1_000));
        const tree = await screen.tree();
        if (!tree.includes('application')) { note = 'app tree empty after tap'; failures.push(`${route} > ${control.name}: ${note}`); }
        for (const text of BAD) if (tree.includes(text)) { note = `shows "${text}"`; failures.push(`${route} > ${control.name}: ${note}`); }
        await app.screenshot(`crawl-${route.replace(/\//g, '_')}-${tapped}-${control.name.slice(0, 24).replace(/\W+/g, '_')}`);
      } catch (error) {
        note = `tap failed: ${String(error).slice(0, 160)}`;
        log({ route, event: 'tap-failed', control: control.name, note });
      }
      log({ route, event: 'tapped', role: control.role, control: control.name, note });
      // Return to a clean copy of the screen: close any sheet, go back once, reopen the route.
      try { await device.back(); } catch { /* nothing to go back to */ }
      await open();
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
}
