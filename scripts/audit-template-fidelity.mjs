import { packTemplateRoutes } from './template-route-data.mjs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
import { modelIdForName } from '../app/veyrnox/_lib/tokens.js';
import { fallbackCapabilitiesFor } from '../lib/fallbackModelCapabilities.js';
import { referenceCount } from '../app/veyrnox/_lib/sourcePromptAudit.js';
import { bind, imageSlots, imageTokenPattern, BINDING_MODEL } from '../lib/templateBinding.js';
import { templateVideoDependency } from '../lib/templateVideoDependency.js';
import { templateAudioDependency } from '../lib/templateAudioDependency.js';
import { GENERATION_PROMPT_MAX } from '../lib/generationPromptLimits.js';
import { ratioOf, nearestOption } from '../lib/aspectShapes.mjs';
import { NEGATIVE_PROMPT_MAX } from '../lib/generationPromptLimits.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';

export const hash = text => createHash('sha256').update(text).digest('hex');
export function auditTemplate(p) {
  const sourcePrompt = p.sourcePrompt;
  const legacyModelId = modelIdForName(p.model);
  const slots = imageSlots(sourcePrompt);
  const imageCount = slots.length || referenceCount(sourcePrompt, 'image');
  const videoCount = referenceCount(sourcePrompt, 'video');
  const video = templateVideoDependency(sourcePrompt);
  const binding = bind(sourcePrompt, slots.length);
  const reasons = [];
  if (video) reasons.push('reference-video-required');
  if (templateAudioDependency(sourcePrompt)) reasons.push('source-audio-not-audited');
  if (slots.length && binding.error) reasons.push(binding.error);
  if (!slots.length && imageCount) reasons.push('unmapped-image-reference');
  if (!slots.length && /<[^>]+>/.test(sourcePrompt)) reasons.push('unmapped-placeholder');
  const target = slots.length && !binding.error ? BINDING_MODEL : legacyModelId;
  let cap = fallbackCapabilitiesFor(target);
  if (!cap || p.sourcePromptStatus === 'exact-truncated') reasons.push('unsupported-source-or-model');
  const wanted = p.aspect || p.clip?.aspectRatio || SHOWCASE_CLIPS[p.clipKey]?.aspectRatio || p.previewAspect;
  const aspects = cap?.inputs?.aspect_ratio?.values || [];
  const aspect = nearestOption(wanted, aspects) || aspects[0] || null;
  if (slots.length && p.aspect && p.aspect !== 'auto' && !aspects.some(a => ratioOf(a) === ratioOf(p.aspect))) reasons.push('unsupported-aspect');
  const duration = cap?.kind === 'video' ? p.durationSeconds ?? 5 : null;
  if (duration && !cap?.lengths?.includes(duration)) reasons.push('unsupported-duration');
  if ((binding.text || sourcePrompt).length > Math.min(GENERATION_PROMPT_MAX, cap?.inputs?.prompt?.max || 0)) reasons.push('prompt-limit');
  const classification = video ? 'blocked-needs-video' : reasons.length ? 'unsupported' : slots.length ? 'bound' : 'like-for-like-safe';
  const bound = classification === 'bound';
  const modelId = bound ? BINDING_MODEL : legacyModelId;
  cap = fallbackCapabilitiesFor(modelId);
  const text = bound ? binding.text : sourcePrompt;
  const hasPhoto = !!cap?.media?.image;
  return { contractVersion: 1, id: p.id, class: classification,
    modelId, allowedModels: [modelId], sourcePrompt, sourceHash: hash(sourcePrompt),
    prompt: text, promptHash: hash(text), photoPrompt: text, photoPromptHash: hash(text),
    ...(bound ? { boundHash: hash(text), tokenMap: binding.map, slotCount: slots.length } : {}),
    identityLine: false, requiredReferences: { imageMin: bound ? slots.length : cap?.media?.image?.required || imageCount ? 1 : 0, imageMax: bound ? slots.length : hasPhoto ? 1 : 0, video },
    duration, aspect: bound ? aspect : nearestOption(wanted, cap?.inputs?.aspect_ratio?.values || []) || cap?.inputs?.aspect_ratio?.values?.[0] || null,
    negativeMax: cap?.inputs?.negative_prompt?.max ?? NEGATIVE_PROMPT_MAX,
    negativePrompt: cap?.inputs?.negative_prompt ? (p.negativePrompt?.trim() || '').slice(0, cap.inputs.negative_prompt.max ?? NEGATIVE_PROMPT_MAX).trimEnd() : '',
    tokens: [...sourcePrompt.matchAll(imageTokenPattern())].map(m => m[0]), imageCount, videoCount, reasons,
    tokenSupport: { image: bound || imageCount === 0, imageTransport: hasPhoto, literalImageTokensBound: bound, video: false, unknownSlots: !reasons.includes('unmapped-placeholder') },
    photoGuidance: hasPhoto ? 'presets.fidelity.photoGuidance' : 'presets.fidelity.noPhoto', minPhotoDimension: 256,
  };
}
export function packContracts(contracts) {
  const prompts = [], indices = new Map();
  const intern = text => { if (!indices.has(text)) { indices.set(text, prompts.length); prompts.push(text); } return indices.get(text); };
  const templates = Object.fromEntries(Object.entries(contracts).map(([id, c]) => {
    const { sourcePrompt, prompt, photoPrompt, ...rest } = c;
    return [id, { ...rest, sourcePromptIndex: intern(sourcePrompt), promptIndex: intern(prompt), photoPromptIndex: intern(photoPrompt) }];
  }));
  return { contractVersion: 1, prompts, templates };
}
export function audit() {
  const contracts = Object.fromEntries(PRESETS.filter(p => p.sourcePromptOrigin === 'community-source-exact').map(p => [p.id, auditTemplate(p)]));
  const totals = { 'like-for-like-safe': 0, bound: 0, 'blocked-needs-video': 0, unsupported: 0 };
  for (const c of Object.values(contracts)) totals[c.class]++;
  const unsupportedReasons = {};
  for (const c of Object.values(contracts).filter(c => c.class === 'unsupported')) {
    for (const reason of c.reasons) unsupportedReasons[reason] = (unsupportedReasons[reason] || 0) + 1;
  }
  const reasonCounts = {};
  for (const c of Object.values(contracts)) for (const reason of c.reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  return { contractVersion: 1, totals, unsupportedReasons, reasonCounts, contracts };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = audit();
  mkdirSync('.gstack', { recursive: true });
  writeFileSync('.gstack/template-fidelity.json', JSON.stringify(report, null, 2) + '\n');
  if (process.argv.includes('--write')) {
    writeFileSync('lib/templateRoutes.json', JSON.stringify(packTemplateRoutes(report.contracts)) + '\n');
    writeFileSync('lib/templateFidelityContracts.json', JSON.stringify(packContracts(report.contracts)) + '\n');
    writeFileSync('docs/product/source-audit/template-fidelity-2026-11-07.md', `# Template fidelity audit — 2026-11-07

Offline structural audit, contract version 1. Reproduce with \`node scripts/audit-template-fidelity.mjs\`; regenerate with \`--write\`.

${Object.entries(report.totals).map(([k,v]) => `- ${k}: ${v}`).join('\n')}

Original source hashes remain unchanged. Only recognized image tokens change in bound text; bound hashes and occurrence maps are recorded in \`lib/templateFidelityContracts.json\`. Bound templates use Seedance reference with 1–9 ordered photos, fixed generated audio, and catalog pricing. No external source audio can be supplied by an active template route.

A2-3 routes all ${report.totals.bound} bound templates by the contract model on feed, card, detail and Create. Web and mobile show exactly N required, ordered photo slots; only complete valid photo selections carry template_id. The web handoff holds up to nine photos in memory only; the mobile handoff uses the existing short-lived, owner-scoped memory store. Unsupported templates remain admitted with the notice. Source-video dependencies are blocked, including harmless prompt edits; independent custom text is admitted.

Structurally validated, not output-verified. No paid provider call, migration, flag or price configuration change. TemplateRecipe and detail markup remain unchanged for non-bound, non-blocked recipes; bound detail model links/names and obsolete crop hints follow the effective model; prose-only video-blocked recipes now show the existing source-video note. Edited-prompt PHOTO_CHARACTER_LINE is preserved.

Owner decision, 7 November 2026: higher Seedance-reference quotes for token-bearing templates are ACCEPTED: one-photo 19 → 85 Credits / 5s and 64 → 170 Credits / 10s; multi-photo templates likewise use the active reference-model quote. No pricing configuration changed.

## All-class reason counts (overlapping)

${Object.entries(report.reasonCounts).map(([k,v]) => `- ${k}: ${v}`).join('\n')}

These include reasons secondary to a video block. Source-audio dependencies in this inventory all also require source video; zero audio-only templates remain unsupported. The original 152 unsupported audio flags resolve to 24 genuine preserved-audio requirements (all blocked for video) and 128 generated/negated directions. The A2-1 review classified the original 142 multiple-reference flags as 98 bound, 41 needing video and 3 unsupported; it classified the original 73 no-image-input flags as 64 bound, 1 needing video and 8 unsupported. The current totals above supersede those historical splits. Multi-photo binding now has fixed-slot web and mobile controls. Round-three grammar changes and reviewed IDs are recorded in .gstack/a2-round3-report.md. Bare image labels require capital Image and a label delimiter; any remaining ambiguous named image reference prevents partial binding.

## Unsupported reason counts (overlapping)

${Object.entries(report.unsupportedReasons).map(([k,v]) => `- ${k}: ${v}`).join('\n')}

## Remaining unbound templates

${Object.values(report.contracts).filter(c => c.class === 'unsupported' || c.class === 'blocked-needs-video').map(c => `- ${c.id}: ${c.reasons.join(', ')}`).join('\n')}
`);
  }
  if (!process.argv.includes('--contracts-only')) {
    const result = spawnSync(process.execPath, ['node_modules/jest/bin/jest.js', '--runInBand', '--watchman=false', '__tests__/templateFidelityParity.test.ts'], {
      cwd: new URL('../apps/mobile', import.meta.url), encoding: 'utf8', env: { ...process.env, TEMPLATE_FIDELITY_AUDIT: '1' },
    });
    if (result.status !== 0) { console.error(result.stderr || result.error); process.exitCode = 1; }
    else {
      report.requestParity = JSON.parse(readFileSync('.gstack/template-request-parity.json', 'utf8'));
      writeFileSync('.gstack/template-fidelity.json', JSON.stringify(report, null, 2) + '\n');
    }
  }
  console.log(JSON.stringify(report.totals));
}
