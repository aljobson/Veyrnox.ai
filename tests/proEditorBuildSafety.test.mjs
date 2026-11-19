import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeOut, MARKER } from '../scripts/build-pro-editor.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZIP = join(tmpdir(), 'some-folder', 'filmcraft-web-0.20.1.zip');

test('the output folder may not be the repo, an ancestor of it, the cwd, home, the root or the zip folder', () => {
  for (const bad of [ROOT, dirname(ROOT), '.', homedir(), sep, dirname(ZIP)]) {
    assert.throws(() => assertSafeOut(bad, { root: ROOT, zip: ZIP }), /unsafe --out/, String(bad));
  }
});

test('inside the repo only a root-level .pro-editor-dist* folder (the ignored one) is allowed', () => {
  for (const bad of ['app', 'pro-editor', '.pro-editor-preview', 'pro-editor/.pro-editor-dist', 'tests/.pro-editor-dist']) {
    assert.throws(() => assertSafeOut(join(ROOT, bad), { root: ROOT, zip: ZIP }), /root-level \.pro-editor-dist/, bad);
  }
  const fresh = join(ROOT, '.pro-editor-dist-never-built-' + process.pid);
  assert.equal(assertSafeOut(fresh, { root: ROOT, zip: ZIP }), fresh);
});

test('an existing folder must be empty or carry the build marker', () => {
  const base = mkdtempSync(join(tmpdir(), 'pro-out-'));
  const full = join(base, 'full');
  mkdirSync(full);
  writeFileSync(join(full, 'precious.txt'), 'keep');
  assert.throws(() => assertSafeOut(full, { root: ROOT, zip: ZIP }), /not empty/);
  const ours = join(base, 'ours');
  mkdirSync(ours);
  writeFileSync(join(ours, MARKER), '');
  writeFileSync(join(ours, 'old.html'), 'x');
  assert.equal(assertSafeOut(ours, { root: ROOT, zip: ZIP }), ours);
  const empty = join(base, 'empty');
  mkdirSync(empty);
  assert.equal(assertSafeOut(empty, { root: ROOT, zip: ZIP }), empty);
  assert.equal(assertSafeOut(join(base, 'new'), { root: ROOT, zip: ZIP }), join(base, 'new'));
  writeFileSync(join(base, 'file'), 'x');
  assert.throws(() => assertSafeOut(join(base, 'file'), { root: ROOT, zip: ZIP }), /not a directory/);
});
