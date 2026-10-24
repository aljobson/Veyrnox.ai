import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowVeyCharacter } from '../lib/veyVisibility.js';

test('Vey stays hidden until help or active guidance needs her', () => {
  assert.equal(shouldShowVeyCharacter(), false);
  assert.equal(shouldShowVeyCharacter({ open: false }), false);
  assert.equal(shouldShowVeyCharacter({ open: true }), true);
  assert.equal(shouldShowVeyCharacter({ activeTarget: 'create.prompt' }), true);
  assert.equal(shouldShowVeyCharacter({ actionPhase: 'tapping' }), true);
});

test('the website keeps a quiet help launcher when Vey is hidden', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../app/veyrnox/_components/MascotAssistant.jsx', import.meta.url), 'utf8');
  assert.match(source, /data-testid="assistant-launcher"/);
  assert.match(source, /showCharacter \? <motion\.div/);
  assert.match(source, /if \(open\) closeHelper\(\)/);
  assert.match(source, /clearTarget\(\);\s+setOpen\(false\)/);
});
