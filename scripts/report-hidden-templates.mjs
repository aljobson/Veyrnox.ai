#!/usr/bin/env node
// Offline owner inventory. Source paths are always relative to this checkout.
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_TEMPLATES, PRESETS, GALLERY_PRESETS } from '../app/veyrnox/_lib/templates.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { SEEDANCE_200_TEMPLATE_METADATA } from '../app/veyrnox/_lib/seedanceTemplateMetadata.js';
import { publicTemplateId } from '../app/veyrnox/_lib/templateIds.js';
import { templateContract } from '../lib/templateContract.js';
import { swapNeedsSourceVideo } from '../lib/templateSwapGuard.js';
import { templateVideoDependency } from '../lib/templateVideoDependency.js';
import { seedanceOrigin } from './lib/template-origin.mjs';
import { kindOf, tierFor, auditRecords, readLocalClip } from './import-template-swap-clips.mjs';
import { outsideRepositories } from './lib/swap-clip-normalise.mjs';
const repo = fileURLToPath(new URL('../', import.meta.url));
const countBy = (rows, key) => rows.reduce((counts, r) => {
  const k = r[key] ?? 'none'; counts[k] = (counts[k] || 0) + 1; return counts;
}, {});
export function routeFit(c) {
  if (!c) return 'none_no_contract';
  if (kindOf(c)) return 'o1_clip';
  if (c.class === 'unsupported') return 'none_unsupported';
  if (['bound', 'like-for-like-safe'].includes(c.class) && !c.requiredReferences.video && !templateVideoDependency(c.sourcePrompt)) {
    if (c.allowedModels.includes('kling-3.0-i2v') && c.requiredReferences.imageMax > 0) return 'kling_i2v_photo';
    if (c.requiredReferences.imageMax === 0) return 'text_only_other_model';
  }
  // A new contract must get an explicit owner decision, not a guessed route.
  throw new Error(`unclassified_route_fit:${c.id}`);
}
export function hiddenTemplateReport() {
  const gallery = new Set(GALLERY_PRESETS.map(p => p.id));
  const describe = p => {
    const c = templateContract(p.id), clip = SHOWCASE_CLIPS[p.clipKey];
    const preview = clip?.video;
    return { id: p.id, galleryState: gallery.has(p.id) ? 'listed' : 'hidden', contractClass: c?.class || null,
      swapWording: !!c && swapNeedsSourceVideo(c.sourcePrompt), seedanceOrigin: !!seedanceOrigin(p.id),
      sourcePlatform: seedanceOrigin(p.id)?.sourcePlatform || null,
      previewClipPresent: !!preview && existsSync(path.join(repo, 'public', preview.replace(/^\//, ''))),
      routeFit: routeFit(c), modelId: c?.modelId || null, allowedModels: c?.allowedModels || [],
      requiredReferences: c?.requiredReferences || null, kind: kindOf(c),
      // A/B is decided by the importer's byte verification; this inventory never approves media.
      tier: kindOf(c) === 'video_swap' ? 'C' : kindOf(c) === 'motion' ? 'D' : kindOf(c) === 'swap' ? 'A/B (hash verification required)' : null };
  };
  const all = ALL_TEMPLATES.map(describe), hidden = all.filter(r => r.galleryState === 'hidden');
  const byId = new Map(all.map(r => [r.id, r]));
  const seedance = Object.keys(SEEDANCE_200_TEMPLATE_METADATA).map(publicTemplateId).map(id => byId.get(id) ||
    { id, seedanceOrigin: true, sourcePlatform: seedanceOrigin(id)?.sourcePlatform || null, galleryState: 'withdrawn_or_absent', routeFit: 'none_no_contract', modelId: null, allowedModels: [], previewClipPresent: false });
  const overBudget = PRESETS.map(p => templateContract(p.id)).filter(c => c?.class === 'bound' && c.prompt.length > 2000)
    .map(c => ({ id: c.id, length: c.prompt.length, modelId: c.modelId }));
  const labelDefects = PRESETS.filter(p => p.model === 'Seedance 2.0 Fast').map(p => ({ id: p.id, label: p.model,
    actualModelId: templateContract(p.id)?.modelId || null, allowedModels: templateContract(p.id)?.allowedModels || [] }));
  return { totals: { addressable: all.length, listed: gallery.size, hidden: hidden.length,
    hiddenClasses: countBy(hidden, 'contractClass'), hiddenRouteFits: countBy(hidden, 'routeFit'),
    hiddenKinds: countBy(hidden, 'kind'), seedanceOrigins: countBy(Object.values(SEEDANCE_200_TEMPLATE_METADATA), 'sourcePlatform'),
    seedanceStates: countBy(seedance, 'galleryState'),
    seedanceHiddenRouteFits: countBy(seedance.filter(r => r.galleryState === 'hidden'), 'routeFit'),
    boundOverBudget: overBudget.length, seedanceLabels: labelDefects.length },
    hidden, becomesRunnableAfterClipApproval: hidden.filter(r => r.routeFit === 'o1_clip' && r.previewClipPresent).map(r => r.id),
    seedance, overBudget, labelDefects };
}
export async function writeHiddenTemplateReport(outDir) {
  const dir = await outsideRepositories(outDir);
  const report = hiddenTemplateReport();
  // Resolve A/B using actual local bytes, exactly as the importer does; no media generation or network.
  const records = await auditRecords();
  for (const row of report.hidden.filter(r => r.kind === 'swap')) {
    const local = await readLocalClip(row.id, path.join(repo, 'public/showcase'));
    const byId = records.find(r => r.id === row.id);
    if (byId && byId.localPreviewSha256 !== local.sha256) throw new Error(`showcase_hash_mismatch:${row.id}`);
    row.clipVerification = byId || records.some(r => r.localPreviewSha256 === local.sha256) ? 'audit_hash' : 'no_audit_record';
    row.tier = tierFor(row.kind, row.clipVerification);
  }
  report.totals.hiddenTiers = countBy(report.hidden.filter(r => r.kind), 'tier');
  await mkdir(dir, { recursive: true });
  const table = rows => '| Id | Gallery | Class | Swap | Seedance origin | Preview | Route fit | Contract model | Allowed models | Image min/max | Tier |\n|---|---|---|---|---|---|---|---|---|---|---|\n' + rows.map(r =>
    `| ${r.id} | ${r.galleryState} | ${r.contractClass || 'none'} | ${!!r.swapWording} | ${!!r.seedanceOrigin} | ${r.previewClipPresent} | ${r.routeFit} | ${r.modelId || 'none'} | ${r.allowedModels.join(', ')} | ${r.requiredReferences ? `${r.requiredReferences.imageMin}/${r.requiredReferences.imageMax}` : 'none'} | ${r.tier || 'none'} |`).join('\n');
  const md = '# Hidden template owner inventory\n\n' +
    'Offline structural route fit, not an activation or likeness guarantee. O1 requires approved and registered media, an active O1 row and the switch; Syntx media also requires explicit --include-syntx. Motion tier D needs its own output review. No gallery, contract, model or price changes.\n\n' +
    'Plan discrepancy: metadata records are 121 Syntx and 79 Higgsfield, resolving to 24 listed, 170 hidden and 6 absent; 52 hidden origin records need clips. The frozen plan claimed 200 Syntx, 14 listed, 61 hidden, 125 absent and 40 clip candidates. The actual metadata governs this report and the importer.\n\n' +
    'Text-only contracts cannot accept a photo or a Kling substitution. Unsupported includes unfillable slots and other contract reasons. Original prompts over the conservative 2,000-character budget remain unchanged.\n\n' +
    '```json\n' + JSON.stringify(report.totals, null, 2) + '\n```\n\n' + table(report.hidden) +
    '\n\n## Hidden ids eligible after clip approval and activation\n\n' + report.becomesRunnableAfterClipApproval.map(id => `- ${id}`).join('\n') +
    '\n\n## All 200 Seedance-origin records (internal provenance)\n\n' + table(report.seedance) +
    '\n\n## Bound prompts over the documented budget\n\n' + report.overBudget.map(r => `- ${r.id}: ${r.length} characters (${r.modelId})`).join('\n') +
    '\n\n## Seedance labels for owner review\n\n' +
    'These labels are not uniformly defects: many are actual text-only contracts. sourceTemplates.js uses runnableModel to construct model, credits and duration; changing it is not a shared display-only fix. No relabelling is proposed in this PR.\n\n' +
    report.labelDefects.map(r => `- ${r.id}: ${r.label}; actual contract ${r.actualModelId || 'none'}; allowed ${r.allowedModels.join(', ')}`).join('\n') + '\n';
  // Exclusive writes also refuse existing symlinks; do not overwrite another review.
  await writeFile(path.join(dir, 'hidden-templates.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(dir, 'hidden-templates.md'), md, { flag: 'wx' });
  return report.totals;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await writeHiddenTemplateReport(process.argv[2]), null, 2));
}
