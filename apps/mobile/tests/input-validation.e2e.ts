import { mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { openSignedIn } from './helpers.js';

// Input validation: every text field on every screen gets hostile and extreme values. Per field and payload it records the
// length the field kept, whether the app stayed healthy, and any error text. Findings are decided from results.jsonl.
// Dev mock only. Nothing is submitted except search fields (Enter) and the Create prompt check.
const ROUTES: string[] = JSON.parse(readFileSync(new URL('./crawl-routes.json', import.meta.url), 'utf8'))
  .concat(['create/nano-banana', 'create/nano-banana-pro-edit-grsai', 'templates/mock-hero']);
const ONLY = process.env.VALIDATE_ONLY ? new RegExp(process.env.VALIDATE_ONLY) : null;
const MAX_FIELDS = 4;

const PAYLOADS: Array<[string, string]> = [
  ['empty', ''],
  ['spaces', '     '],
  ['long800', 'a'.repeat(800)],
  ['longword400', 'x'.repeat(400)],
  ['emoji', '🧑‍🚀🔥👩🏽‍🎤'.repeat(40)],
  ['arabic-rtl', 'مرحبا بالعالم '.repeat(20)],
  ['bidi-override', 'user‮gnp.exe'],
  ['script', '<script>alert(1)</script><img src=x onerror=alert(1)>'],
  ['sql', "'; DROP TABLE users; --"],
  ['path', '../../etc/passwd'],
  ['format', '%s%s%s%n {{7*7}} ${7*7}'],
  ['newlines', 'line1\nline2\r\nline3\t\ttabbed'],
];
const BAD = ['Unmatched Route', 'Something went wrong', 'Uncaught Error', 'This screen doesn’t exist'];

mkdirSync('.e2e/validate', { recursive: true });
const log = (row: Record<string, unknown>) => appendFileSync('.e2e/validate/results.jsonl', JSON.stringify(row) + '\n');

function fieldsFrom(tree: string): Array<{ role: string; name: string; secure: boolean }> {
  const seen = new Set<string>();
  const out: Array<{ role: string; name: string; secure: boolean }> = [];
  for (const line of tree.split('\n')) {
    const m = line.match(/^\s*#\S+\s+(textbox|searchbox|textarea|text-field|combobox)\s+"([^"]*)"(.*)$/);
    if (!m) continue;
    const key = `${m[1]}|${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role: m[1], name: m[2], secure: /secure|password/i.test(m[2] + m[3]) });
  }
  return out;
}

for (const route of ROUTES) {
  if (ONLY && !ONLY.test(route)) continue;
  test(`validate /${route}`, { tags: ['validate'] }, async ({ app, device, screen }) => {
    await openSignedIn(app, screen);
    await device.openLink(`ai.veyrnox.app://${route}`);
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const fields = fieldsFrom(await screen.tree()).filter(f => !f.secure).slice(0, MAX_FIELDS);
    log({ route, event: 'fields', fields: fields.map(f => f.name) });
    const failures: string[] = [];

    for (const field of fields) {
      for (const [id, value] of PAYLOADS) {
        // A fresh copy of the screen per payload: typing long text can wedge the iOS runner and shift the layout.
        try {
          await device.openLink(`ai.veyrnox.app://${route}`);
          await new Promise(resolve => setTimeout(resolve, 1_200));
          const lead = field.name.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const input = screen.getByRole(field.role as never, { name: new RegExp('^' + lead) }).first();
          await input.fill(value, { timeout: 12_000 });
          const kept = (await input.inputValue()).length;
          const tree = await screen.tree();
          const healthy = tree.includes('application') && !BAD.some(b => tree.includes(b));
          const counter = tree.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
          const note: string[] = [];
          if (!healthy) { note.push('UNHEALTHY'); failures.push(`${route} > ${field.name} < ${id}: app unhealthy`); }
          if (counter) {
            const limit = Number(counter[2].replace(/,/g, ''));
            if (kept > limit) { note.push(`OVER_LIMIT ${kept}>${limit}`); failures.push(`${route} > ${field.name} < ${id}: kept ${kept} chars over visible limit ${limit}`); }
          }
          if (/search/i.test(field.name) && value.trim()) {
            try { await input.press('Enter', { timeout: 3_000 }); await new Promise(r => setTimeout(r, 1_200)); } catch { /* no submit key */ }
            const after = await screen.tree();
            if (!after.includes('application') || BAD.some(b => after.includes(b))) { note.push('UNHEALTHY_AFTER_SEARCH'); failures.push(`${route} > ${field.name} < ${id}: unhealthy after search`); }
          }
          log({ route, field: field.name, payload: id, sent: value.length, kept, counter: counter ? counter[0] : null, note });
        } catch (error) {
          log({ route, field: field.name, payload: id, sent: value.length, harness_error: String(error).slice(0, 140) });
          await new Promise(resolve => setTimeout(resolve, 6_000));
        }
        try { await device.dismissKeyboard(); } catch { /* ignore */ }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
}
