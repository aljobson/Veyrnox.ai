// Informational only. Never feed this inventory into sourcePromptRunnable or publication.
// Use grammatical gaps, not a mismatch between upload totals and numbered slots:
// ordinary prose can refer to uploaded images without numbering them.
const patterns = [
  ['empty reference before punctuation', /(?<![\w-])(?:from|of|with)\s*[,.;+]/i],
  ['empty reference before punctuation', /\bin\s+[.;]/i],
  ['missing reference between connectors', /(?<![\w-])(?:from\s+(?:with|and|to|as|same face)|in\s+(?:with|was)|person\s+in\s+and|with\s+from)\b/i],
  ['empty reference group', /\(\s*,\s*\)/],
  ['missing reference after article', /\bthe\s+from\b/i],
  ['missing replacement before scope', /\bSwap the car of\s+Original\s+Video for all scenes\b/i],
  ['missing swap subject', /^\s*swap\s+to\s+the person\b/i],
  ['missing reference assignment', /(?:^|\n)\s*=\s*character\b/i],
  ['missing conditional subject', /\bIf already\s+(?:contains|has|is)\b/i],
  ['missing reference before line break', /\b(?:from|with|on)[ \t]*\r?\n[ \t]*(?:\r?\n[ \t]*)?(?:swap|and swap|same face)\b/i],
  ['missing reference at end', /\b(?:from|with|of|on)\s*$/i],
  ['missing Spanish reference', /\b(?:de\s*,|de\s+y\b|como se ve en\s*$)/i],
  ['missing reference after use', /\bUse\s+(?:exclusively to preserve|as the (?:sole|only|exclusive|identity|absolute|primary|full-body))\b/i],
];

export function sourceReferenceGapKinds(prompt) {
  return [...new Set(patterns.filter(([, pattern]) => pattern.test(prompt)).map(([kind]) => kind))].sort();
}

export function sourceReferenceGaps(records) {
  const inventory = records.flatMap(record => {
    const kinds = sourceReferenceGapKinds(record.prompt);
    return kinds.length ? [{ id: record.id, kinds,
      ...(Number.isInteger(record.inputAssetCount) ? { inputAssetCount: record.inputAssetCount } : {}),
    }] : [];
  });
  return {
    policy: 'These rows are exact as published but incomplete by origin: source feeds delete reference mentions. Keep their captured bytes and informational compatibility flags unchanged. The owner may hide them.',
    method: 'scripts/lib/source-reference-gaps.mjs detects orphaned reference connectors, empty assignments and missing subjects, and records capture input-asset counts where available. Counts corroborate gaps; upload totals alone do not imply missing text. This is a conservative text-pattern inventory, not a completeness guarantee.',
    count: inventory.length, inventory,
  };
}
