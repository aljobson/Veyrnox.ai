import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('general QA only exempts an exact refresh POST, not session establishment, clearing or other writes', () => {
  const source = readFileSync(new URL('../e2e/authenticated-general.spec.mjs', import.meta.url), 'utf8');
  const match = source.match(/const writes = ([^]*?);\n/);
  assert.ok(match, 'the actual test write guard must be independently testable');
  const writes = runInNewContext(`(${match[1]})`);
  const requests = [
    { method: 'GET', path: '/api/v1/account' },
    { method: 'OPTIONS', path: '/api/auth/session' },
    { method: 'POST', path: '/api/auth/session', body: { action: 'refresh' } },
    { method: 'POST', path: '/api/auth/session', body: { action: 'establish' } },
    { method: 'POST', path: '/api/auth/session', body: { action: 'clear' } },
    { method: 'DELETE', path: '/api/auth/session', body: { action: 'refresh' } },
    { method: 'POST', path: '/api/auth/session', body: null },
    { method: 'POST', path: '/api/v1/generations', body: {} },
  ];
  assert.deepEqual([...writes({ requests })], requests.slice(3));
});
