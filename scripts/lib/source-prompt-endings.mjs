import { sourceReferenceGapKinds } from './source-reference-gaps.mjs';
import { REVIEWED_AMBIGUOUS_ENDINGS } from './reviewed-ambiguous-endings.mjs';

// A triage check, not a language-completeness classifier. Unpunctuated sentences
// and source-stripped slots are never automatically unpublished. A trailing
// connector without an origin-gap pattern remains ambiguous too: a connector
// alone never auto-rejects or hides a row. A trailing comma is classified clipped.
export function sourcePromptEnding(record) {
  const text = record.prompt.trimEnd();
  const tail = text.slice(-80);
  if (text.endsWith(',')) return { id: record.id, status: 'clipped', reason: 'Unfinished list ending in a comma.', tail };
  if (/[.!?"')\]}*:]$/.test(text)) return null;
  const connector = /\b(?:and|or|with|from|of|to|in|on|en)\s*$/i.test(text);
  const line = text.split(/\r?\n/).at(-1);
  // Complete list items, source tokens and non-Latin sentence punctuation.
  if (!connector && (/^(?:[-*•]|\d+[.)])\s+\S/.test(line) || /<<<(?:image|video)_\d+>>>$/.test(text) || /[。！？]$/.test(text) || /^[━─]+$/.test(line))) return null;
  return { id: record.id, status: 'ambiguous', kind: connector ? 'connector' : 'unpunctuated', reason: connector && sourceReferenceGapKinds(text).length
    ? 'Trailing connector accompanies origin-stripped references; retained by origin-gap policy.'
    : connector ? 'Trailing connector without an origin-gap pattern; connector alone remains ambiguous and never auto-rejects a row.'
      : 'Unpunctuated ending; no unambiguous mid-word truncation or unfinished list.', tail };
}

export function sourcePromptEndingReview(records) {
  const detected = records.map(sourcePromptEnding).filter(Boolean);
  const reviewed = REVIEWED_AMBIGUOUS_ENDINGS.flatMap(review => {
    const record = records.find(r => r.id === review.id);
    return record && !detected.some(r => r.id === review.id)
      ? [{ id: record.id, status: 'ambiguous', kind: 'reviewed', reason: review.reason, tail: record.prompt.trimEnd().slice(-80) }]
      : [];
  });
  return {
    policy: 'Informational ending triage. Trailing connectors remain ambiguous, including without origin-gap patterns; a connector alone never auto-rejects or hides a row. Reviewed ambiguities supplement the punctuation detector without rewriting source text.',
    scanned: records.length,
    ambiguousUnpunctuatedCount: detected.filter(r => r.status === 'ambiguous').length,
    reviewedAmbiguousCount: reviewed.length,
    inventory: [...detected, ...reviewed],
  };
}
