import type { SpeechAnalysis, SpeechRange } from './speechCut';
/** TypeScript twin of app/veyrnox/_lib/smartCutFillers.js; the speechFillers test pins parity. Review-only. */
export const FILLER_WORDS: Record<string, readonly string[]> = {
    en: ['um', 'umm', 'uh', 'uhm', 'er', 'erm', 'hmm', 'mm', 'mmm'], es: ['eh', 'em', 'ehm', 'mm', 'mmm', 'hmm'],
    de: ['äh', 'ähm', 'öh', 'ehm', 'hm', 'hmm'], fr: ['euh', 'heu', 'hm', 'hmm'], pt: ['hum', 'ahn', 'hm', 'hmm'], ru: ['э', 'ээ', 'эм', 'мм', 'ммм'] };
const PADDING = .03, MAX_SUGGESTIONS = 50;
const floor = (n: number) => Math.floor(n * 100) / 100;
const ceil = (n: number) => Math.max(0, Math.ceil(n * 100 - 1e-9) / 100);
const normalise = (text: string, language: string) => String(text || '').normalize('NFKC').toLocaleLowerCase(language).replace(/[^\p{L}\p{N}]/gu, '');
/** Hesitation sounds only. Phrase-level timing, unknown or unsupported languages return nothing. */
export function fillerRanges(analysis: SpeechAnalysis, selectedRange?: Pick<SpeechRange, 'start' | 'end'>): SpeechRange[] {
    if (analysis.timingQuality === 'phrase' || !FILLER_WORDS[analysis.language]) return [];
    const range = selectedRange && Number.isFinite(selectedRange.start) && Number.isFinite(selectedRange.end) && selectedRange.end > selectedRange.start
        ? selectedRange : null;
    const fillers = new Set(FILLER_WORDS[analysis.language]), chunks = analysis.chunks, found: SpeechRange[] = [];
    chunks.forEach((chunk, index) => {
        if (!fillers.has(normalise(chunk.text, analysis.language))) return;
        if (range && (chunk.end <= range.start || chunk.start >= range.end)) return;
        const previousEnd = index > 0 ? chunks[index - 1].end : 0, nextStart = index < chunks.length - 1 ? chunks[index + 1].start : analysis.duration;
        const paddedStart = Math.min(chunk.start, Math.max(previousEnd, floor(chunk.start - PADDING)));
        const paddedEnd = Math.max(chunk.end, Math.min(nextStart, ceil(chunk.end + PADDING)));
        const start = range ? Math.max(range.start, paddedStart) : paddedStart;
        const end = range ? Math.min(range.end, paddedEnd) : paddedEnd;
        if (end - start < .02) return;
        const last = found.at(-1);
        if (last && start <= last.end) { last.end = Math.max(last.end, end); last.label += ` ${chunk.text}`; }
        else found.push({ start, end, label: String(chunk.text) });
    });
    return found.slice(0, MAX_SUGGESTIONS);
}
