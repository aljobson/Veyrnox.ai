// Smart Cut filler suggestions (SMART_CUT.md follow-on slice 6, first half: detection only).
// Review-only: this returns proposed removals and never edits a clip. The phone twin is
// apps/mobile/src/lib/speechFillers.ts and tests/ pin that the two agree.

// Pure hesitation sounds only. Words that can carry meaning ("like", "so", "you know", "well")
// are deliberately absent, and scripts without a reliable spelling for hesitations are skipped.
export const SMART_CUT_FILLER_WORDS = Object.freeze({
  en: Object.freeze(['um', 'umm', 'uh', 'uhm', 'er', 'erm', 'hmm', 'mm', 'mmm']),
  es: Object.freeze(['eh', 'em', 'ehm', 'mm', 'mmm', 'hmm']),
  de: Object.freeze(['äh', 'ähm', 'öh', 'ehm', 'hm', 'hmm']),
  fr: Object.freeze(['euh', 'heu', 'hm', 'hmm']),
  pt: Object.freeze(['hum', 'ahn', 'hm', 'hmm']),
  ru: Object.freeze(['э', 'ээ', 'эм', 'мм', 'ммм']),
});

export const SMART_CUT_FILLER_PADDING_SECONDS = 0.03;
export const SMART_CUT_MAX_FILLER_SUGGESTIONS = 50;

const floorHundredth = (value) => Math.floor(value * 100) / 100;
const ceilHundredth = (value) => Math.max(0, Math.ceil(value * 100 - 1e-9) / 100);
const normalise = (text, language) => String(text || '')
  .normalize('NFKC')
  .toLocaleLowerCase(language)
  .replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Propose removals for hesitation sounds in a normalised analysis record.
 * Needs word-level timing: a phrase-level record, an unknown or unsupported language,
 * or a record without words returns no suggestions rather than a guess.
 */
export function smartCutFillerRanges(analysis) {
  if (!analysis || analysis.timingQuality === 'phrase' || !Array.isArray(analysis.chunks)) return [];
  const list = SMART_CUT_FILLER_WORDS[analysis.language];
  if (!list) return [];
  const fillers = new Set(list);
  const chunks = analysis.chunks;
  const found = [];
  chunks.forEach((chunk, index) => {
    if (!fillers.has(normalise(chunk.text, analysis.language))) return;
    const previousEnd = index > 0 ? chunks[index - 1].end : 0;
    const nextStart = index < chunks.length - 1 ? chunks[index + 1].start : analysis.duration;
    const start = Math.min(chunk.start, Math.max(previousEnd, floorHundredth(chunk.start - SMART_CUT_FILLER_PADDING_SECONDS)));
    const end = Math.max(chunk.end, Math.min(nextStart, ceilHundredth(chunk.end + SMART_CUT_FILLER_PADDING_SECONDS)));
    if (end - start < 0.02) return;
    const last = found.at(-1);
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
      last.label = `${last.label} ${chunk.text}`;
    } else {
      found.push({ start, end, label: String(chunk.text) });
    }
  });
  return found.slice(0, SMART_CUT_MAX_FILLER_SUGGESTIONS);
}
