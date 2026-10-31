import test from 'node:test';
import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import { checkWorkerSize, checkWrapper, forbiddenWrapperInput, parseUploadKiB, WORKER_SIZE_BUDGET_KIB } from '../scripts/check-worker-size.mjs';

test('size parser reads uncompressed KiB and fails closed for missing or invalid output', () => {
  assert.equal(WORKER_SIZE_BUDGET_KIB, 56000);
  assert.equal(parseUploadKiB('Total Upload: 60490 KiB / gzip: 12290 KiB'), 60490);
  assert.equal(parseUploadKiB('Total Upload: 54,321.50 KiB / gzip: 9000 KiB'), 54321.5);
  assert.equal(parseUploadKiB('Total Upload: 10 KiB\nTotal Upload: 20 KiB'), 20);
  for (const output of ['', 'gzip: 100 KiB', 'Total Upload: NaN KiB', 'Total Upload: 0 KiB']) {
    assert.throws(() => parseUploadKiB(output), /valid Total Upload/);
  }
});

test('size guard uses the larger measurement and rejects either over-budget result without spawning', async () => {
  const lines = [];
  const options = (upload, disk) => ({
    run: async () => `Total Upload: ${upload} KiB / gzip: 1 KiB`,
    measure: async () => disk * 1024, report: (line) => lines.push(line),
  });
  assert.equal(await checkWorkerSize(options(54000, 55000)), 55000);
  assert.equal(await checkWorkerSize(options(56000, 55000)), 56000);
  await assert.rejects(checkWorkerSize(options(60490, 55000)), /exceeds/);
  await assert.rejects(checkWorkerSize(options(54000, 56000.01)), /exceeds/);
  await assert.rejects(checkWorkerSize(options(54000, 0)), /no measurable/);
  await assert.rejects(checkWorkerSize({ ...options(1, 1), run: async () => { throw new Error('dry-run failed'); } }), /dry-run failed/);
  assert.match(lines[0], /55000.00 KiB/);
});

test('wrapper input policy rejects every forbidden family and permits only English public catalogs', () => {
  for (const path of [
    'app/veyrnox/_lib/templates.js', 'app/veyrnox/_lib/sourcePromptRecords.js',
    'app/veyrnox/_lib/sourceTemplate.js', '/checkout/app/veyrnox/_lib/sourceTemplates.js',
    'lib/i18n/messages/ru.mjs', 'lib/i18n/messages/app/en.mjs',
    'lib/i18n/messages/presets/ru/steps.mjs', 'lib\\i18n\\messages\\ru.mjs',
  ]) assert.equal(forbiddenWrapperInput(path), true, path);
  for (const path of ['lib/i18n/messages/en.mjs', 'lib/i18n/messages/email/ru.mjs', 'lib/i18n/messages/presets/en/steps.mjs', 'app/veyrnox/_lib/tokens.js']) {
    assert.equal(forbiddenWrapperInput(path), false, path);
  }
});

test('wrapper report checks all inputs, including forbidden inputs below the top twenty, without bundling', async () => {
  const inputs = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`lib/file${i}.js`, { bytes: (i + 1) * 1024 }]));
  inputs['lib/i18n/messages/en.mjs'] = { bytes: 1 };
  const metafile = { inputs, outputs: { 'worker-entry.js': { bytes: 2048 } } };
  const lines = [];
  const bundle = async (options) => {
    assert.deepEqual(options.entryPoints, ['worker-entry.js']);
    assert.deepEqual(options.external, ['./.open-next/worker.js', 'node:*', ...builtinModules, 'cloudflare:*']);
    assert.deepEqual(options.conditions, ['workerd', 'worker', 'browser']);
    assert.equal(options.format, 'esm');
    assert.equal(options.metafile, true);
    assert.equal(options.write, false);
    return { metafile };
  };
  await checkWrapper({ bundle, report: (line) => lines.push(line) });
  assert.equal(lines.length, 22);
  assert.match(lines[1], /21.00 lib\/file20.js/);
  assert.match(lines.at(-1), /2.00 KiB bundled/);
  inputs['lib/i18n/messages/app/ru.mjs'] = { bytes: 1 };
  await assert.rejects(checkWrapper({ bundle, report: () => {} }), /Forbidden wrapper inputs:\nlib\/i18n\/messages\/app\/ru.mjs/);
});
