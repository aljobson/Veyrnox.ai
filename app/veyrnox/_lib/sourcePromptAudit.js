import { GENJUTSU_SOURCE_PROMPT_RECORDS } from './genjutsuSourcePromptRecords.js';
import { HIGGSFIELD_90_SOURCE_PROMPT_RECORDS } from './higgsfieldCommunityExpansion90Records.js';
import { SYNTX_SOURCE_PROMPT_RECORDS } from './syntxSourcePromptRecords.js';
import { SEEDANCE_SOURCE_PROMPT_RECORDS } from './seedanceSourcePromptRecords.js';
import { GENERATION_PROMPT_MAX } from '../../../lib/generationPromptLimits.js';

const EXACT_PROMPT_MAX = GENERATION_PROMPT_MAX;
const EXACT_SOURCE_RECORDS = Object.freeze({
  ...GENJUTSU_SOURCE_PROMPT_RECORDS,
  ...HIGGSFIELD_90_SOURCE_PROMPT_RECORDS,
  ...SYNTX_SOURCE_PROMPT_RECORDS,
  ...SEEDANCE_SOURCE_PROMPT_RECORDS,
});

const referenceCount = (prompt, kind) => {
  const indices = [];
  const expressions = [
    new RegExp(`@${kind}\\s*[_-]?(\\d+)`, 'gi'),
    new RegExp(`<<<\\s*${kind}[_\\s-]*(\\d+)\\s*>>>`, 'gi'),
    new RegExp(`\\b${kind}\\s+(\\d+)\\b`, 'gi'),
  ];
  for (const expression of expressions) {
    for (const match of String(prompt || '').matchAll(expression)) indices.push(Number(match[1]));
  }
  return indices.length ? Math.max(...indices) : 0;
};

const mentionsPreservedAudio = (prompt) => /\b(audio|music|soundtrack|speech|lip[ -]?sync|voice|dialogue)\b/i.test(prompt);

// Exact community prompts are provenance, not a generation contract. This
// audit record makes that distinction machine-readable for web, mobile and
// external clients instead of silently presenting an adaptation as the source.
export function sourcePromptAuditRecord(templateId) {
  const source = EXACT_SOURCE_RECORDS[templateId];
  if (!source) {
    return Object.freeze({
      status: 'adaptation-only',
      runnable: false,
      issues: Object.freeze(['exact-source-prompt-not-recorded']),
      characterCount: 0,
      referenceImageCount: 0,
      referenceVideoCount: 0,
      duplicateOf: null,
    });
  }
  if (!source.sourcePromptAvailable || typeof source.prompt !== 'string' || !source.prompt) {
    return Object.freeze({
      status: 'unavailable',
      runnable: false,
      issues: Object.freeze(['source-prompt-unavailable']),
      characterCount: 0,
      referenceImageCount: 0,
      referenceVideoCount: 0,
      duplicateOf: source.sourcePromptDuplicateOf ?? null,
    });
  }

  const issues = [];
  const imageCount = referenceCount(source.prompt, 'image');
  const videoCount = referenceCount(source.prompt, 'video');
  if (source.prompt.length > EXACT_PROMPT_MAX) issues.push('prompt-over-30000');
  if (imageCount > 0) issues.push('reference-image-input-required');
  if (imageCount > 1) issues.push('more-than-one-reference-image');
  if (imageCount > 2) issues.push('more-than-two-reference-images');
  if (videoCount > 0) issues.push('reference-video-not-supported');
  const requiresPreservedAudio = mentionsPreservedAudio(source.prompt);
  if (requiresPreservedAudio) issues.push('audio-preservation-not-supported');
  if (source.sourcePromptTruncated) issues.push('source-prompt-truncated');
  const runnable = !source.sourcePromptTruncated
    && source.prompt.length <= EXACT_PROMPT_MAX
    && imageCount === 0
    && videoCount === 0
    && !requiresPreservedAudio;
  if (!runnable) issues.push('source-input-contract-not-wired');

  return Object.freeze({
    status: source.sourcePromptTruncated ? 'exact-truncated' : 'exact',
    runnable,
    issues: Object.freeze(issues),
    characterCount: source.prompt.length,
    referenceImageCount: imageCount,
    referenceVideoCount: videoCount,
    duplicateOf: source.sourcePromptDuplicateOf ?? null,
  });
}

// Add the assigned generation model's verified text bound to the source-only
// audit. Full prompt text remains available even when that model must not be
// charged for it.
export function sourcePromptAuditForModel(templateId, promptMax = EXACT_PROMPT_MAX) {
  const sourceAudit = sourcePromptAuditRecord(templateId);
  if (sourceAudit.status !== 'exact' || sourceAudit.characterCount <= promptMax) return sourceAudit;
  const issues = [...sourceAudit.issues];
  if (!issues.includes('model-prompt-limit-exceeded')) issues.push('model-prompt-limit-exceeded');
  if (!issues.includes('source-input-contract-not-wired')) issues.push('source-input-contract-not-wired');
  return Object.freeze({ ...sourceAudit, runnable: false, issues: Object.freeze(issues), modelPromptMax: promptMax });
}

// Public templates must either carry a complete exact source prompt or be an
// explicitly independent Veyrnox adaptation. Matched records whose prompt is
// absent or truncated remain audit evidence, but are not publishable.
export function isPublishableSourcePromptTemplate(templateId) {
  const status = sourcePromptAuditRecord(templateId).status;
  return status === 'exact' || status === 'adaptation-only';
}

export const SOURCE_PROMPT_AUDIT_STATUSES = Object.freeze([
  'exact',
  'exact-truncated',
  'unavailable',
  'adaptation-only',
]);
