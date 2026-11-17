import test from 'node:test';
import assert from 'node:assert/strict';
import { hiddenTemplateReport, routeFit, writeHiddenTemplateReport } from '../scripts/report-hidden-templates.mjs';
import { clipOrigin } from '../scripts/lib/template-origin.mjs';
import { swapCandidates, auditRecords } from '../scripts/import-template-swap-clips.mjs';
import { templateContract } from '../lib/templateContract.js';
const report = hiddenTemplateReport();
test('hidden and Seedance-origin inventory counts come from the current modules', () => {
  assert.deepEqual(report.totals, {
    addressable: 1926, listed: 150, hidden: 1776,
    hiddenClasses: { 'blocked-needs-video': 392, unsupported: 98, 'like-for-like-safe': 232, bound: 12, none: 1042 },
    hiddenRouteFits: { o1_clip: 447, none_unsupported: 78, text_only_other_model: 112, kling_i2v_photo: 97, none_no_contract: 1042 },
    hiddenKinds: { video_swap: 300, none: 1329, motion: 92, swap: 55 },
    seedanceOrigins: { Syntx: 121, Higgsfield: 79 }, seedanceStates: { listed: 24, withdrawn_or_absent: 6, hidden: 170 },
    seedanceHiddenRouteFits: { none_unsupported: 34, o1_clip: 52, text_only_other_model: 84 }, boundOverBudget: 53, seedanceLabels: 238,
  });
  assert.equal(report.becomesRunnableAfterClipApproval.length, 447);
  assert.equal(report.overBudget.find(r => r.id === 'jellyfish-airlines').length, 5814);
});
test('hidden clip list matches importer candidates; plain photo fit follows allowed models and references', async () => {
  const hidden = new Set(report.hidden.map(r => r.id));
  assert.deepEqual((await swapCandidates()).filter(c => hidden.has(c.id)).map(c => c.id).sort(), [...report.becomesRunnableAfterClipApproval].sort());
  for (const row of report.hidden) {
    const c = templateContract(row.id);
    if (row.routeFit === 'kling_i2v_photo') {
      assert.ok(c.allowedModels.includes('kling-3.0-i2v')); assert.ok(c.requiredReferences.imageMax); assert.equal(c.requiredReferences.video, false);
    }
    if (row.routeFit === 'text_only_other_model') assert.equal(c.requiredReferences.imageMax, 0);
  }
  assert.equal(routeFit({ class: 'like-for-like-safe', sourcePrompt: 'Text', modelId: 'seedance-2.0-fast', allowedModels: ['seedance-2.0-fast'], requiredReferences: { imageMax: 0 } }), 'text_only_other_model');
});
test('origin exclusion uses metadata and every matching audit record, not only the file prefix', async () => {
  assert.equal(clipOrigin('sm-brand-new-day'), 'syntx');
  assert.equal(clipOrigin('renamed', [{ id: 'sm-brand-new-day', origin: 'seedance' }]), 'syntx');
  assert.equal(clipOrigin('renamed', [{ id: 'unknown', origin: 'higgsfield' }, { id: 'other', sourcePlatform: 'Syntx', origin: 'seedance' }]), 'syntx');
  assert.equal(clipOrigin('unknown', [{ id: 'other', origin: 'syntx' }]), 'syntx');
  assert.equal(clipOrigin('unknown', [{ id: 'other', origin: 'higgsfield' }]), 'higgsfield');
  const records = await auditRecords();
  assert.ok(records.some(r => r.origin === 'seedance' && clipOrigin(r.id, [r]) === 'syntx'));
});
test('owner report refuses writes into any checkout', async () => {
  await assert.rejects(writeHiddenTemplateReport(process.cwd()), /path_inside_repo/);
});
