// Registered by sourceTemplates.test.mjs so the agreed proof includes the capture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SOURCE_TEMPLATES } from '../../app/veyrnox/_lib/sourceTemplates.js';
import { SOURCE_PROMPT_RECORDS, exactSourcePromptRecord } from '../../app/veyrnox/_lib/sourcePromptRecords.js';
import { HIGGSFIELD_300_SOURCE_PROMPT_RECORDS } from '../../app/veyrnox/_lib/higgsfieldCommunityExpansion300Records.js';
import { HIGGSFIELD_300_TEMPLATE_IDS } from '../../app/veyrnox/_lib/sourceTemplateExpansion14.js';
import { PRESETS, REMOVED_PROMPT_GAP_TEMPLATE_IDS } from '../../app/veyrnox/_lib/templates.js';
import { HIGGSFIELD_300_PROMPT_SHA256 } from '../fixtures/higgsfield300PromptHashes.mjs';
import { audit, baseline, sha256, uniquenessTables, verifyNewHashes, publicPath, BASELINE_SOURCE_AUTHENTIC_DUPLICATES, unexpectedDuplicateGroups } from '../../scripts/audit-higgsfield-300.mjs';

const newIds = new Set(HIGGSFIELD_300_TEMPLATE_IDS);

test('the clipped desktop capture retains only rejection identifiers, hashes and reason', () => {
  assert.equal(audit.requested, 300);
  assert.equal(audit.accepted, 299);
  assert.equal(audit.rejected.length, 1);
  const rejected = audit.rejected[0];
  assert.equal(rejected.id, 'community-miniature-desktop-chase');
  assert.equal(rejected.sourcePromptSha256, 'a252a7b07a5fdc4b37c598e3f187fe51ddea3799c13f5605591626e81d88410c');
  assert.match(rejected.reason, /unfinished.*trailing comma/);
  assert.ok(Object.keys(rejected).every(key => key === 'id' || key === 'reason' || key.endsWith('Id') || key.endsWith('Sha256')));
  assert.equal(SOURCE_PROMPT_RECORDS[rejected.id], undefined);
  assert.equal(HIGGSFIELD_300_PROMPT_SHA256[rejected.id], undefined);
  assert.equal(newIds.has(rejected.id), false);
  for (const ext of ['mp4', 'jpg']) assert.equal(existsSync(publicPath('/showcase/creator-' + rejected.id + '.' + ext)), false);
});

test('299 retained raw and audit prompts match the immutable host hashes; published copy only strips platform words', () => {
  assert.equal(newIds.size, 299);
  assert.equal(Object.keys(HIGGSFIELD_300_SOURCE_PROMPT_RECORDS).length, 299);
  assert.equal(Object.keys(HIGGSFIELD_300_PROMPT_SHA256).length, 299);
  assert.equal(audit.records.length, 299);
  assert.equal(new Set(audit.records.map(r => r.id)).size, 299);
  for (const r of audit.records) {
    const raw = SOURCE_PROMPT_RECORDS[r.id];
    assert.ok(newIds.has(r.id), r.id);
    assert.equal(raw.sourcePromptAvailable, true, r.id);
    assert.equal(raw.sourceAuditStatus, 'verified-2026-11-05', r.id);
    assert.equal(raw.sourceTitle, r.sourceTitle, r.id);
    assert.equal(raw.sourceMediaId, r.sourceMediaId, r.id);
    assert.equal(raw.prompt, r.prompt, r.id);
    assert.equal(sha256(raw.prompt), HIGGSFIELD_300_PROMPT_SHA256[r.id], r.id);
    assert.equal(sha256(r.prompt), HIGGSFIELD_300_PROMPT_SHA256[r.id], r.id);
    assert.equal(r.sourcePromptSha256, HIGGSFIELD_300_PROMPT_SHA256[r.id], r.id);
    assert.equal(exactSourcePromptRecord(r.id).prompt, raw.prompt.replace(/\b(?:higgsfield|syntx)\s+/gi, ''), r.id);
    for (const url of [r.sourceMediaUrl, r.sourceMainMediaUrl]) {
      assert.equal(new URL(url).pathname.split('/')[2], r.sourceMediaId, r.id);
      assert.equal(new URL(url).search, '', r.id);
    }
    assert.equal(r.inputAssets.length, r.inputAssetCount, r.id);
    assert.ok(r.inputAssets.every(a => ['image', 'video'].includes(a.role) && a.mediaId), r.id);
  }
  assert.match(SOURCE_PROMPT_RECORDS['community-boutique-hoodie-reveal'].prompt, /HIGGSFIELD AI GENJUTSU/);
  assert.doesNotMatch(exactSourcePromptRecord('community-boutique-hoodie-reveal').prompt, /HIGGSFIELD/);
});

test('exact-only publication retains the baseline records and non-prompt template metadata', () => {
  const frozen = JSON.parse(readFileSync(new URL('../fixtures/exactOnlyBaseline.json', import.meta.url)));
  assert.equal(SOURCE_TEMPLATES.length, 827);
  assert.equal(PRESETS.length, 757);
  assert.equal(SOURCE_TEMPLATES.filter(t => exactSourcePromptRecord(t.id)).length, 758);
  assert.equal(PRESETS.filter(t => exactSourcePromptRecord(t.id)).length, 757);
  assert.deepEqual([...REMOVED_PROMPT_GAP_TEMPLATE_IDS].sort(), [...baseline.excluded, ...frozen.hidden27].sort());
  const reviewed = JSON.parse(readFileSync(new URL('../fixtures/exactOnlyReviewedMetadata.json', import.meta.url)));
  const excluded = new Set(['prompt', 'sourcePrompt', 'sourcePromptOrigin', 'negativePrompt', 'promptOrigin', 'sourcePromptRunnable', 'sourcePromptIssues', 'sourcePromptModelPromptMax', 'preferAdaptedPrompt']);
  for (const [id, hash] of Object.entries(frozen.templates)) {
    const renamed = frozen.publicIdRenames[id];
    const current = SOURCE_TEMPLATES.find(t => t.id === (renamed?.id || id));
    for (const [field, value] of Object.entries(reviewed[id]?.after || {})) assert.deepEqual(current[field], value, id + ': ' + field);
    const t = {...current, ...reviewed[id]?.before};
    if (renamed) {
      assert.equal(current.name, renamed.name);
      assert.equal(current.clipKey, renamed.id);
    }
    assert.equal(sha256(JSON.stringify(Object.fromEntries(Object.entries(t).filter(([key]) => !excluded.has(key))))), hash, id);
  }
  for (const [id, hash] of Object.entries(baseline.sourceRecords)) assert.equal(sha256(JSON.stringify(SOURCE_PROMPT_RECORDS[id])), hash, id);
});

test('827 retained templates reject all unapproved id, name, prompt, media, video, poster and visual duplicates', () => {
  const tables = uniquenessTables();
  for (const [field, table] of Object.entries(tables)) assert.deepEqual(table.unexpected, [], field);
  for (const [field, groups] of Object.entries(BASELINE_SOURCE_AUTHENTIC_DUPLICATES)) {
    assert.deepEqual(tables[field].duplicates, [...groups].sort(), `${field}: only the locked baseline groups`);
    for (const group of groups) {
      for (const id of group.split('|')) {
        assert.equal(newIds.has(id), false, `${id}: new IDs must never be allow-listed`);
        assert.ok(Object.hasOwn(baseline.templates, id), `${id}: exception must predate this batch`);
      }
    }
  }
  for (const [field, table] of Object.entries(tables)) {
    for (const group of table.duplicates) {
      assert.ok(group.split('|').every(id => !newIds.has(id)), `${field}: no new record may participate in a duplicate`);
    }
  }
});

test('duplicate exceptions reject new participants, unknown old pairs and raw equality of normalized-only pairs', () => {
  for (const id of newIds) {
    const group = ['curtain-reveal', 'who-was-that-business', id].sort().join('|');
    const entries = group.split('|').map(member => [member, 'same']);
    for (const field of ['promptHash', 'normalizedPrompt']) {
      assert.deepEqual(unexpectedDuplicateGroups(field, entries), [group], `${field}: ${id}`);
    }
  }
  const unknownPair = [['i-am-here', 'same'], ['piano-vibe', 'same']];
  assert.deepEqual(unexpectedDuplicateGroups('normalizedPrompt', unknownPair), ['i-am-here|piano-vibe']);
  for (const group of ['i-am-here|somebody', 'piano-vibe|wassup-freestyle']) {
    assert.deepEqual(unexpectedDuplicateGroups('promptHash', group.split('|').map(id => [id, 'same'])), [group]);
  }
});

test('299 retained prepared clips preserve their supplied bytes, five-second duration, silent track and poster budgets', () => {
  assert.equal(verifyNewHashes(), 293966731);
  for (const r of audit.records) {
    assert.equal(r.startSeconds, 0, r.id);
    assert.ok(Math.abs(r.previewDuration - 5) < 0.11, r.id);
    assert.equal(r.previewFps, 24, r.id);
    const data = readFileSync(publicPath(r.previewPath));
    const offset = data.indexOf('mvhd', 0, 'ascii');
    assert.ok(offset > 0, r.id);
    const version = data[offset + 4];
    const timescale = data.readUInt32BE(offset + (version === 1 ? 24 : 16));
    const duration = version === 1 ? Number(data.readBigUInt64BE(offset + 28)) : data.readUInt32BE(offset + 20);
    assert.ok(Math.abs(duration / timescale - 5) < 0.11, r.id);
    let handler = 0;
    while ((handler = data.indexOf('hdlr', handler, 'ascii')) !== -1) {
      assert.notEqual(data.toString('ascii', handler + 12, handler + 16), 'soun', r.id);
      handler += 4;
    }
  }
});

test('299 retained community prompts are exact while their established model settings remain unchanged', () => {
  for (const t of SOURCE_TEMPLATES.filter(t => newIds.has(t.id))) {
    assert.equal(t.promptOrigin, 'community-source-exact', t.id);
    assert.equal(t.prompt, exactSourcePromptRecord(t.id).prompt, t.id);
    assert.equal(t.sourcePrompt, t.prompt, t.id);
    assert.equal(t.model, 'Kling 3.0 · I2V', t.id);
    assert.equal(t.durationSeconds, 10, t.id);
    assert.equal(t.credits, 32, t.id);
    assert.equal(Object.hasOwn(t, 'aspect'), false, t.id);
    assert.equal(Object.hasOwn(t, 'negativePrompt'), false, t.id);
    assert.match(t.needsKey, /^community\.(?:group|cinematic)$/, t.id);
  }
});
