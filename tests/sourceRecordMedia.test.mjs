import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { IMAGE_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/imageSourcePromptRecords.js';
import { sourcePromptAuditRecord } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { sourceMediaEntries, sourceRecordIdsForMedia, sameSourceMedia } from '../scripts/lib/source-record-media.mjs';
import { assertAvailablePublicIds } from '../scripts/lib/template-public-id.mjs';

const image = IMAGE_SOURCE_PROMPT_RECORDS['flying-elf'];
test('absent source media never matches another absence, including the captured image record', () => {
  const records = { image, missing: {}, nullRecord: null, blank: { sourceMediaId: ' ' }, video: { sourceMediaId: 'video-id' } };
  assert.equal(image.sourceMediaId, undefined);
  assert.deepEqual(sourceMediaEntries(records), [['video', 'video-id']]);
  for (const absent of [undefined, null, '', ' ']) {
    assert.deepEqual(sourceRecordIdsForMedia(records, absent), []);
    assert.equal(sameSourceMedia(image, absent), false);
  }
  assert.deepEqual(sourceRecordIdsForMedia(records, 'video-id'), ['video']);
  assert.equal(sourceMediaEntries(SOURCE_PROMPT_RECORDS).some(([id]) => id === 'flying-elf'), false);
  assert.deepEqual(sourceRecordIdsForMedia(SOURCE_PROMPT_RECORDS, undefined), []);
});

test('public-id reservations and exact-source audit remain safe without image media', () => {
  assert.throws(() => assertAvailablePublicIds(['flying-elf'], []), /collision/);
  assert.doesNotThrow(() => assertAvailablePublicIds(['unused-media-guard-test'], []));
  assert.equal(sourcePromptAuditRecord('flying-elf').status, 'exact');
  assert.equal(sourcePromptAuditRecord('flying-elf').runnable, true);
  const captured = Object.entries(SOURCE_PROMPT_RECORDS).filter(([, r]) => r.sourcePromptAvailable && typeof r.prompt === 'string');
  assert.equal(captured.filter(([id]) => !Object.hasOwn(IMAGE_SOURCE_PROMPT_RECORDS, id)).length, 772);
  assert.equal(captured.filter(([id]) => Object.hasOwn(IMAGE_SOURCE_PROMPT_RECORDS, id)).length, 1);
  assert.equal(captured.length, 773);
});

test('migration, audit and replacement consumers use the guarded media identity operations', () => {
  const read = file => readFileSync(file, 'utf8');
  assert.match(read('scripts/sync-template-public-ids.mjs'), /sourceRecordIdsForMedia\(SOURCE_PROMPT_RECORDS, row\.sourceMediaId\)/);
  assert.match(read('scripts/audit-higgsfield-300.mjs'), /sourceMediaEntries\(SOURCE_PROMPT_RECORDS\)/);
  for (const file of ['scripts/import-replacement-templates-hf.mjs', 'scripts/import-replacement-templates-syntx.mjs']) {
    assert.match(read(file), /sameSourceMedia\(r, m\.mediaId \|\| m\.sourceMediaId\)/);
  }
});
