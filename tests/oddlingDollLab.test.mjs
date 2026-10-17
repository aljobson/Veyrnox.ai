import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../app/veyrnox/_components/OddlingStudio.js', import.meta.url), 'utf8');
const catalog = await readFile(new URL('../app/veyrnox/_components/OddlingCatalog.js', import.meta.url), 'utf8');

test('Oddling Studio presents a Sims-style catalog and a price-forward action', () => {
  assert.match(source, /<OddlingCatalog picks=\{picks\} onPick=\{setPick\}/);
  assert.match(catalog, /ODDLING CATALOG/);
  assert.match(catalog, /Every choice updates the real generation prompt/);
  assert.match(catalog, /The final picture is made by AI from these choices/);
  assert.match(source, /Generate portrait/);
  assert.match(source, /Animate character/);
  assert.match(source, /LIVE PRICE/);
  assert.match(source, /NO CHARGE UNTIL CONFIRMED/);
  assert.match(source, /oddlingPicks: picks/);
  assert.match(source, /router\.push\(destination\)/);
  assert.match(source, /Opening Create/);
});

test('Create visibly confirms the exact edited Oddling handoff', async () => {
  const create = await readFile(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
  assert.match(create, /storedDraft\?\.oddlingPicks/);
  assert.match(create, /setCharacter\(imported\)/);
  assert.match(create, /handoffPicks=\{oddlingTransfer\}/);
  assert.match(create, /ODDLING LOADED/);
  assert.match(create, /is linked to this generation/);
  assert.match(create, /Review character/);
});

test('balance lookup is gated by a stored session and warns before Create', () => {
  assert.match(source, /if \(!session\) \{ setBalance\(null\); return; \}/);
  assert.match(source, /gatewayFetch\('\/balance'\)/);
  assert.match(source, /Credits are running low/);
  assert.match(source, /Not enough credits/);
  assert.match(source, /href="\/app\/credits"/);
  assert.doesNotMatch(source, /gatewayFetch\('\/generations'/);
});
