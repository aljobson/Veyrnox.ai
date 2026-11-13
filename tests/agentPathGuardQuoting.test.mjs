import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), 'utf8');

test('every bot path guard asks git for unquoted names', () => {
  assert.match(read('agent-fixer.yml'), /git -c core\.quotepath=false apply --numstat/);
  assert.match(read('agent-daily.yml'), /git -c core\.quotepath=false diff --name-only/);
  assert.match(read('pr-gate.yml'), /git -c core\.quotepath=false diff --name-only/);
});

test('a name git still quotes is refused or counted as protected', () => {
  assert.match(read('agent-fixer.yml'), /\(\^"\|\^\//);
  assert.match(read('agent-daily.yml'), /grep -q '\^"'/);
  assert.match(read('pr-gate.yml'), /grep '\^"'/);
});
