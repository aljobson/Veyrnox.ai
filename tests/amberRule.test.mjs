import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('U3: warn is its own token in every theme block', () => {
  const css = read('app/globals.css');
  assert.equal((css.match(/--vx-warn:/g) || []).length, 3, 'dark, light and print');
  assert.match(read('app/veyrnox/veyrnox.css'), /\.vx-paper \{[^}]*--vx-warn:/);
  assert.match(css, /--color-vx-warn: rgb\(var\(--vx-warn\)\)/);
});

test('U3: warnings and notices do not use amber', () => {
  const chip = read('app/veyrnox/_components/Chip.js');
  assert.match(chip, /warn:\s+\{ cls: 'border-vx-warn\/40 text-vx-warn bg-vx-warn\/\[0\.07\]'/);
  for (const p of [
    'app/veyrnox/m/layout.js',
    'app/veyrnox/social-cinema/pass/PassPanel.js',
    'app/veyrnox/guides/[id]/page.js',
  ]) assert.doesNotMatch(read(p), /vx-money/, p);
  const credits = read('app/veyrnox/app/credits/page.js');
  assert.match(credits, /text-vx-warn[^\n]*\n[^\n]*\n\s*<span>Sign in to see your balance/);
  assert.doesNotMatch(read('app/veyrnox/app/library/page.js'), /starred \? 'text-vx-money'/);
});

test('U3: debits and tile prices are amber', () => {
  assert.match(read('app/veyrnox/_components/CreditStatement.js'), /entry\.delta > 0 \? 'text-vx-accent' : 'text-vx-money'/);
  assert.match(read('app/veyrnox/_sections/footer.js'), /l\.delta > 0 \? 'text-vx-accent' : 'text-vx-money'/);
  assert.match(read('app/veyrnox/_sections/showcase.js'), /text-\[#E4A93C\] vx-num/);
  assert.match(read('app/veyrnox/_sections/hero.js'), /row \? 'text-\[#E4A93C\]' : ''/);
});

test('U8: the design-system page shows the receipt slip and the warn colour', () => {
  const page = read('app/veyrnox/design-system/page.js');
  assert.match(page, /num="09" title="RECEIPT SLIP/);
  for (const cls of ['vx-paper-shadow', 'vx-paper ', 'vx-leader', 'vx-perf']) assert.ok(page.includes(cls), cls);
  assert.match(page, /token: 'warn'/);
  assert.doesNotMatch(page, /amber △/);
  assert.match(page, /text-vx-warn bg-vx-warn\/\[0\.07\]">\s*<span aria-hidden="true">△<\/span>ATTENTION/);
});
