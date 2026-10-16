import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../e2e/env.mjs', import.meta.url), 'utf8').replaceAll('export const ', 'const ');
function load(value, refuseConfig = false) {
  const env = new Proxy({ E2E_BASE_URL: value }, { get(target, key) {
    if (refuseConfig && key !== 'E2E_BASE_URL') throw new Error('configuration read before target validation');
    return target[key];
  } });
  return runInNewContext(`${source}\nBASE_URL`, { URL, process: { env } });
}

for (const value of [undefined, 'https://staging.example.invalid', 'https://staging.example.invalid/', 'http://127.0.0.1:3100', 'https://staging.example.invalid:443/']) {
  test(`accepts staging origin ${value ?? 'default'}`, () => {
    assert.equal(load(value), value ? new URL(value).origin : 'https://veyrnox-ai-staging.al-jobson.workers.dev');
  });
}
for (const value of [
  'https://veyrnox.ai', 'http://veyrnox.ai', 'https://www.veyrnox.ai', 'https://admin.veyrnox.ai',
  'https://VEYRNox.AI', 'https://veyrnox.ai:443/', 'https://veyrnox.ai.', 'https://veyrnox.ai../',
  'https://www.veyrnox.ai./', 'https://%76eyrnox.ai', 'https://veyrnox%2eai', 'https://veyrnox。ai',
  'https://veyrnox.ai/path', 'https://user:secret@veyrnox.ai', 'https://user@staging.example.invalid',
  'https://staging.example.invalid/path', 'https://staging.example.invalid/?x=1', 'https://staging.example.invalid/#a',
  'https://staging.example.invalid/../', 'https://staging.example.invalid//', 'https://staging.example.invalid?',
  'https://staging.example.invalid#', 'https://staging.example.invalid\\path',
  'https:\\veyrnox.ai', 'https:veyrnox.ai', '//veyrnox.ai', 'veyrnox.ai', 'not a url',
  'file:///private/tmp', 'javascript:alert(1)', 'ftp://staging.example.invalid',
  ' https://staging.example.invalid', 'https://staging.example.invalid\n', 'https://staging.example.invalid/%2e%2e',
  'https://staging.example.invalid\u0000', 'https://staging.example.invalid\u0001', 'https://staging.example.invalid\u001f',
]) {
  test(`rejects unsafe target before reading authentication config: ${JSON.stringify(value)}`, () => {
    assert.throws(() => load(value, true), /e2e: refusing/);
  });
}
