import { parseSmartCutAnalysis, type SpeechAnalysis, type SpeechChunk } from './speechCut';
export const BEST_CUT_LANGUAGES = ['en', 'es', 'zh', 'hi', 'ar', 'fr', 'pt', 'ru', 'ja', 'de', 'ko'] as const;
export type BestCutPreset = 'balanced' | 'vlog' | 'educational' | 'punchy' | 'steps';
export type BestCutInput = { mediaId: string; analysis: SpeechAnalysis };
export type BestCutRange = { mediaId: string; from: number; to: number; start: number; label: string };
export type BestCutPlan = { fps: number; ranges: BestCutRange[]; removedPauses: number; removedRetakes: number; removedRepeats: number; matchedLines: number; missingLines: number[]; droppedClips: number; warnings: ('tail' | 'sections' | 'language')[] };
type Utterance = { mediaId: string; clip: number; words: SpeechChunk[]; text: string; tokens: string[]; language: string; start: number; end: number; quality: number; index: number };
export function bestCutTokens(text: string, language: string): string[] {
    const value = text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, '').trim();
    return ['zh', 'ja'].includes(language) ? Array.from(value.replace(/\s/gu, '')) : value.split(/\s+/u).filter(Boolean);
}
function lcs(a: string[], b: string[], budget: { remaining: number }): number {
    budget.remaining -= a.length * b.length;
    if (budget.remaining < 0) throw new Error('alignment_budget');
    let row = new Uint16Array(b.length + 1);
    for (const token of a) {
        const next = new Uint16Array(b.length + 1);
        for (let j = 0; j < b.length; j++) next[j + 1] = token === b[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]);
        row = next;
    }
    return row[b.length];
}
// Isolated fillers are uncertain speech, not automatic removal candidates.
const fillers = new Set(['um', 'uh', 'eh', 'euh', 'aeh', 'äh', 'ähm', 'emm', 'эм', 'ээ', '嗯', '呃', 'えー', 'えっと', '음', '어', 'उम', 'अं', 'أمم', 'آه']);
const terminal = (text: string) => /[.!?。！？؟]$/u.test(text.trim());
const prefix = (a: string[], b: string[]) => a.length > 0 && a.length < b.length && a.every((v, i) => v === b[i]);
const exact = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
function utterances(inputs: BestCutInput[]): Utterance[] {
    const out: Utterance[] = [];
    inputs.forEach(({ mediaId, analysis }, clip) => {
        let current: Utterance | undefined;
        for (const word of analysis.chunks) {
            if (!current || word.start - current.end >= .45 || terminal(current.text)) {
                current = { mediaId, clip, words: [], text: '', tokens: [], language: analysis.language, start: word.start, end: word.end, quality: 0, index: out.length };
                out.push(current);
            }
            current.words.push(word); current.text += `${current.text ? ' ' : ''}${word.text}`; current.end = Math.max(current.end, word.end);
        }
    });
    for (const u of out) {
        u.tokens = bestCutTokens(u.text, u.language);
        const repeats = u.tokens.filter((v, i) => i > 0 && v === u.tokens[i - 1]).length;
        const pauses = u.words.filter((w, i) => i > 0 && w.start - u.words[i - 1].end >= .3).length;
        u.quality = .25 * Math.max(0, 1 - (repeats + pauses) / Math.max(1, u.tokens.length)) + (terminal(u.text) ? .1 : 0);
    }
    return out;
}
/** Deterministic local planner. Script and notes are never model inputs. All ranges use integer frames. */
function buildBestCutPlanInternal(inputs: BestCutInput[], script = '', preset: BestCutPreset = 'balanced', fps = 30): BestCutPlan | null {
    if (!inputs.length || inputs.length > 10 || script.length > 20000 || ![24, 25, 30, 60].includes(fps)
        || new Set(inputs.map(c => c.mediaId)).size !== inputs.length) return null;
    const parsed: BestCutInput[] = [];
    for (const input of inputs) {
        const result = parseSmartCutAnalysis(input.analysis);
        if (!result.ok || result.analysis.duration < .5 || result.analysis.duration > 60) return null;
        parsed.push({ mediaId: input.mediaId, analysis: result.analysis });
    }
    const all = utterances(parsed), budget = { remaining: 2000000 };
    // Bound quadratic alignment on malformed/dense transcripts; fail closed, never freeze the phone.
    if (all.length > 1000 || all.some(u => u.tokens.length > 600)) return null;
    const plan: BestCutPlan = { fps, ranges: [], removedPauses: 0, removedRetakes: 0, removedRepeats: 0, matchedLines: 0, missingLines: [], droppedClips: 0, warnings: [] };
    let chosen = all;
    const lines = script.split(/\n+|(?<=[.!?。！？؟])\s*/u).map(s => s.trim()).filter(Boolean);
    if (lines.length > 200) return null;
    const conservative = preset === 'educational' || preset === 'steps';
    if (lines.length) {
        chosen = []; const used = new Set<number>();
        lines.forEach((line, index) => {
            let best: Utterance | undefined, score = -1;
            for (const u of all) {
                if (u.language === 'und' || used.has(u.index)) continue;
                const tokens = bestCutTokens(line, u.language); if (!tokens.length || tokens.length > 600) continue;
                const overlap = lcs(tokens, u.tokens, budget);
                if (overlap / Math.max(tokens.length, u.tokens.length) < .6) continue;
                const value = .6 * overlap / tokens.length + u.quality + .05 * u.index / Math.max(1, all.length - 1);
                if (value > score) { best = u; score = value; }
            }
            if (best) { used.add(best.index); chosen.push(best); plan.matchedLines++; }
            else plan.missingLines.push(index + 1);
        });
        // Unknown language disables take logic instead of pretending a script match.
        chosen.push(...all.filter(u => u.language === 'und'));
    } else if (preset === 'vlog') {
        chosen = parsed.flatMap((input, clip) => input.analysis.language === 'und' ? all.filter(u => u.clip === clip) : all.filter(u => u.clip === clip).sort((a, b) => b.quality - a.quality || b.index - a.index).slice(0, 1));
    } else {
        const parent = all.map((_, i) => i);
        const root = (n: number): number => parent[n] === n ? n : (parent[n] = root(parent[n]));
        const falseStarts = new Set<number>();
        for (let i = 0; i < all.length; i++) {
            const a = all[i]; if (a.language === 'und' || !a.tokens.length || (a.tokens.length === 1 && fillers.has(a.tokens[0]))) continue;
            const next = all[i + 1];
            if (!conservative && next && next.clip === a.clip && next.language === a.language && prefix(a.tokens, next.tokens)) falseStarts.add(i);
            for (let j = i + 1; j < all.length; j++) {
                const b = all[j]; if (b.clip > a.clip + 1) break;
                if (a.language !== b.language || !b.tokens.length) continue;
                const distance = a.clip === b.clip ? b.start - a.end : parsed[a.clip].analysis.duration - a.end + b.start;
                if (distance < 0 || distance > 8) continue;
                const match = conservative ? exact(a.tokens, b.tokens)
                    : prefix(a.tokens, b.tokens) || lcs(a.tokens, b.tokens, budget) / Math.max(a.tokens.length, b.tokens.length) >= .8;
                if (match) parent[root(j)] = root(i);
            }
        }
        const winners = new Map<number, Utterance>();
        for (const u of all) {
            if (falseStarts.has(u.index)) continue;
            const r = root(u.index), prev = winners.get(r);
            if (!prev || u.quality > prev.quality || (u.quality === prev.quality && (preset === 'punchy' && u.end - u.start !== prev.end - prev.start ? u.end - u.start < prev.end - prev.start : u.index > prev.index))) winners.set(r, u);
        }
        chosen = [...winners.values()].sort((a, b) => a.index - b.index);
        plan.removedRetakes = all.length - chosen.length;
    }
    if (parsed.some(c => c.analysis.language === 'und')) plan.warnings.push('language');
    const durations = new Map(parsed.map(c => [c.mediaId, c.analysis.duration]));
    let lastWord: { mediaId: string; index: number; end: number } | undefined;
    for (const u of chosen) {
        if (preset === 'vlog' && u.language !== 'und') {
            const duration = durations.get(u.mediaId)!;
            const start = Math.max(0, Math.min(u.start - .12, duration - 2));
            plan.ranges.push({ mediaId: u.mediaId, from: Math.ceil(start * fps), to: Math.floor(Math.min(duration, start + Math.max(2, Math.min(4, u.end - start + .12))) * fps), start: 0, label: u.text });
            lastWord = undefined; continue;
        }
        let words = u.words;
        if (u.language !== 'und') words = words.filter((word, i) => {
            if (!i || word.start < words[i - 1].end) return true;
            const a = bestCutTokens(words[i - 1].text, u.language), b = bestCutTokens(word.text, u.language);
            if (a.length === 1 && !fillers.has(a[0]) && exact(a, b)) { plan.removedRepeats++; return false; } return true;
        });
        const originalWords = parsed[u.clip].analysis.chunks;
        const keptWords = new Set(words);
        for (let i = 0; i < words.length; i++) {
            const word = words[i], previous = plan.ranges.at(-1);
            const wordIndex = originalWords.indexOf(word), previousWord = originalWords[wordIndex - 1], nextWord = originalWords[wordIndex + 1];
            const removedPrevious = previousWord && u.words.includes(previousWord) && !keptWords.has(previousWord);
            const removedNext = nextWord && u.words.includes(nextWord) && !keptWords.has(nextWord);
            // Padding never crosses the midpoint to a neighbouring word, so reordered neighbours cannot overlap in the source.
            const lower = previousWord ? (removedPrevious ? previousWord.end : (previousWord.end + word.start) / 2) : 0;
            const upper = nextWord ? (removedNext ? nextWord.start : (word.end + nextWord.start) / 2) : Infinity;
            const from = Math.max(0, Math.ceil(Math.max(word.start - .12, lower) * fps));
            const to = Math.min(Math.floor(durations.get(u.mediaId)! * fps), Math.floor(Math.min(word.end + .12, upper) * fps));
            if (to <= from) continue;
            // Never bridge a deliberately removed repeated word, a take boundary, or a script reorder.
            const contiguousWord = lastWord?.mediaId === u.mediaId && wordIndex === lastWord.index + 1 && word.start - lastWord.end < .75;
            if (previous && previous.mediaId === u.mediaId && from >= previous.from
                && (contiguousWord || from <= previous.to)) {
                previous.to = Math.max(previous.to, to); previous.label += ` ${word.text}`;
            } else {
                if (i > 0 && word.start - words[i - 1].end >= .75) plan.removedPauses++;
                plan.ranges.push({ mediaId: u.mediaId, from, to, start: 0, label: word.text });
            }
            lastWord = { mediaId: u.mediaId, index: wordIndex, end: word.end };
        }
    }
    // Count long pauses between utterances too, including ones removed by selection.
    plan.removedPauses += all.filter((u, i) => i > 0 && u.clip === all[i - 1].clip && u.start - all[i - 1].end >= .75).length;
    // Merge adjacent output sections only when doing so preserves script order and does not reuse source frames.
    while (plan.ranges.length > 10) {
        let at = -1, gap = Infinity;
        for (let i = 0; i < plan.ranges.length - 1; i++) {
            const a = plan.ranges[i], b = plan.ranges[i + 1], distance = b.from - a.to;
            if (a.mediaId === b.mediaId && distance >= 0 && distance < gap && !plan.ranges.some((r, j) => j !== i && j !== i + 1 && r.mediaId === a.mediaId && r.from < b.to && r.to > a.from)) { at = i; gap = distance; }
        }
        if (at < 0) return null; // Cannot drop script lines silently to fit the section cap.
        const [a, b] = plan.ranges.slice(at, at + 2);
        plan.ranges.splice(at, 2, { ...a, to: b.to, label: `${a.label} ${b.label}` });
        if (!plan.warnings.includes('sections')) plan.warnings.push('sections');
    }
    let cursor = 0;
    plan.ranges = plan.ranges.flatMap(r => {
        if (cursor >= 60 * fps) { if (!plan.warnings.includes('tail')) plan.warnings.push('tail'); return []; }
        const len = Math.min(r.to - r.from, 60 * fps - cursor);
        if (len < r.to - r.from && !plan.warnings.includes('tail')) plan.warnings.push('tail');
        const range = { ...r, to: r.from + len, start: cursor, label: r.label.slice(0, 200) }; cursor += len; return [range];
    });
    plan.removedPauses = parsed.reduce((count, input) => count + input.analysis.chunks.filter((word, i, words) => {
        if (!i || word.start - words[i - 1].end < .75) return false;
        const middle = (word.start + words[i - 1].end) * fps / 2;
        return !plan.ranges.some(range => range.mediaId === input.mediaId && range.from <= middle && range.to >= middle);
    }).length, 0);
    return validateBestCutPlan(plan, parsed) ? plan : null;
}
export function buildBestCutPlan(inputs: BestCutInput[], script = '', preset: BestCutPreset = 'balanced', fps = 30): BestCutPlan | null {
    try { return buildBestCutPlanInternal(inputs, script, preset, fps); } catch { return null; }
}
export function validateBestCutPlan(plan: BestCutPlan, inputs: BestCutInput[]): boolean {
    if (![24, 25, 30, 60].includes(plan.fps) || !plan.ranges.length || plan.ranges.length > 10) return false;
    let cursor = 0;
    for (let i = 0; i < plan.ranges.length; i++) {
        const r = plan.ranges[i], source = inputs.find(c => c.mediaId === r.mediaId);
        if (!source || ![r.from, r.to, r.start].every(Number.isSafeInteger) || r.from < 0 || r.to <= r.from
            || r.to > Math.floor(source.analysis.duration * plan.fps) || r.start !== cursor) return false;
        if (plan.ranges.slice(0, i).some(p => p.mediaId === r.mediaId && r.from < p.to && r.to > p.from)) return false;
        cursor += r.to - r.from;
    }
    return cursor <= 60 * plan.fps;
}
