import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('U5: Inter is referenced through its next/font variable, set on <html>', () => {
  const layout = readFileSync(new URL('../app/layout.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  // Tailwind's preflight puts font-sans on <html>, so the variable must be
  // defined there or the whole declaration is invalid.
  assert.match(layout, /<html lang="en" data-scroll-behavior="smooth" className=\{inter\.variable\}>/);
  assert.match(css, /font-family: var\(--font-inter\),/);
  assert.match(css, /--font-sans: var\(--font-inter\),/);
  assert.doesNotMatch(css, /'Inter'/);
});
