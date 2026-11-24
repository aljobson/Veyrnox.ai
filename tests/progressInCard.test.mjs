import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bar = readFileSync(new URL('../app/veyrnox/_components/GenerationStatusBar.js', import.meta.url), 'utf8');
const card = readFileSync(new URL('../app/veyrnox/app/create/GeneratingProgress.js', import.meta.url), 'utf8');

test('a job drawn in its own card shows its bar there, and the floating bar leaves it out', () => {
  assert.match(card, /useInlineProgress\(jobId\)/);
  assert.match(card, /<ProgressMeter percent=\{progress\.percent\} \/>/);
  assert.match(bar, /all\.filter\(\(row\) => !owned\.has\(row\.job_id\)\)/);
});

test('the card meter is an announced progress bar and respects reduced motion', () => {
  assert.match(bar, /export function ProgressMeter/);
  assert.match(bar, /role="progressbar"[^>]*aria-valuenow=\{percent\}/);
  assert.match(bar, /motion-reduce:transition-none/);
});

test('the registry of card-drawn jobs adds on mount and removes on unmount', () => {
  const hook = bar.slice(bar.indexOf('export function useInlineProgress'), bar.indexOf('// Rows to show'));
  assert.match(hook, /inline = new Set\(\[\.\.\.inline, jobId\]\)/);
  assert.match(hook, /inline = new Set\(\[\.\.\.inline\]\.filter\(\(id\) => id !== jobId\)\)/);
});
