import test from 'node:test';
import assert from 'node:assert/strict';
import { hiddenTemplateReport, routeFit, writeHiddenTemplateReport } from '../scripts/report-hidden-templates.mjs';
import { clipOrigin } from '../scripts/lib/template-origin.mjs';
import { swapCandidates, auditRecords } from '../scripts/import-template-swap-clips.mjs';
import { templateContract } from '../lib/templateContract.js';
// 17 Nov 2026: withdrawing the duplicate community-midnight-fridge-feast (PR 2379) took it out of the gallery: listed 150 -> 149, hidden +1.
// 18 Nov 2026: hiding the 71 swap recipes the server refuses (owner) took them out of the gallery: listed 149 -> 73, hidden +76 (71 refused by the guard + 5 it missed; the guard now also reads 14 hidden templates as video swaps).
// 20 Nov 2026 (ADR-0309 amendment 3): 49 long one-photo recipes bind to the dark kie Seedance offer: unsupported 159 -> 110,
// hidden bound 85 -> 134 (route fit seedance_long_photo, 48 + 1 that stays an O1 clip candidate), bound over 2,000 characters 4 -> 53.
// They stay hidden while the seedanceLongTemplates runtime key is off (this report reads the off state).
// 21 Nov 2026 (owner, "tidy the cards"): two near-duplicate supercar refuel templates left the gallery: listed 28 -> 26, hidden +2
// (both bound Kling I2V photo recipes: bound 134 -> 136, kling_i2v_photo 83 -> 85, kind none 1374 -> 1376).
// 21 Nov 2026 (owner): community-supercar-midnight-refuel failed two paid swap tests and left the gallery: listed 26 -> 25, hidden +1
// (bound 136 -> 137, kling_i2v_photo 85 -> 86, kind none 1376 -> 1377).
// 21 Nov 2026 (owner): five clip-dependent prompts left the gallery: listed 25 -> 20, hidden +5.
// 21 Nov 2026 (owner, ADR-0351 amendment 20): 51 tested swap templates joined the gallery: listed 20 -> 71, hidden -51.
const report = hiddenTemplateReport();
test('hidden and Seedance-origin inventory counts come from the current modules', () => {
  assert.deepEqual(report.totals, {
    addressable: 1926, listed: 61, hidden: 1865,
    hiddenClasses: { 'blocked-needs-video': 367, unsupported: 110, 'like-for-like-safe': 215, bound: 131, none: 1042 },
    hiddenRouteFits: { o1_clip: 473, none_unsupported: 89, seedance_long_photo: 48, text_only_other_model: 112, kling_i2v_photo: 101, none_no_contract: 1042 },
    hiddenKinds: { video_swap: 300, none: 1392, motion: 67, swap: 106 },
    seedanceOrigins: { Syntx: 121, Higgsfield: 79 }, seedanceStates: { withdrawn_or_absent: 6, hidden: 194 },
    seedanceHiddenRouteFits: { none_unsupported: 32, seedance_long_photo: 23, o1_clip: 53, text_only_other_model: 84, kling_i2v_photo: 2 }, boundOverBudget: 53, seedanceLabels: 238,
  });
  assert.equal(report.becomesRunnableAfterClipApproval.length, 473);
  assert.equal(report.overBudget.find(r => r.id === 'community-supercar-midnight-refuel').length, 2454);
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
