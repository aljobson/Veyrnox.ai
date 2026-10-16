import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('every insufficient-credit creation surface links to billing', () => {
  const create = read('app/veyrnox/app/create/page.js');
  const videoAgent = read('app/veyrnox/app/video-agent/page.js');
  const edit = read('app/veyrnox/_components/EditSheet.js');
  for (const source of [create, videoAgent, edit]) assert.match(source, /href="\/app\/credits"/);
});

test('account exposes billing management and Cinema cancellation uses an accessible confirmation', () => {
  const account = read('app/veyrnox/app/account/page.js');
  const pass = read('app/veyrnox/social-cinema/pass/PassPanel.js');
  assert.match(account, /Billing &amp; subscriptions/);
  assert.match(account, /href="\/app\/credits#credit-subscriptions"/);
  assert.match(pass, /1,500 delivered minutes each calendar month/);
  assert.match(pass, /<ConfirmDialog/);
  assert.doesNotMatch(pass, /window\.confirm/);
});
