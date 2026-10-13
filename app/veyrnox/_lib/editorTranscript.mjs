import { cutSequenceRange } from './editorCaptions.mjs';
import { updateSequenceClip } from './editorSequence.mjs';
import { validateSequence } from './editorSequenceValidation.mjs';
/** Existing captions are the persisted transcript. No inferred word intervals are created here. */
export function transcriptEntries(tl, trackId = 'all') {
    return tl.text.filter(cue => cue.caption && (trackId === 'all' || cue.trackId === trackId)).flatMap(cue => {
        const words = (cue.words || []).map((word, index) => ({ key: `${cue.id}:${index}`, captionId: cue.id, trackId: cue.trackId, wordIndex: index, text: word.text,
            start: cue.start + Math.max(0, word.start), len: Math.min(cue.len, word.start + word.len) - Math.max(0, word.start), estimated: cue.wordsEstimated !== false,
            clipped: word.start < 0 || word.start + word.len > cue.len })).filter(word => word.len > 0);
        return words.length ? words : [{ key: `${cue.id}:cue`, captionId: cue.id, trackId: cue.trackId, wordIndex: null, text: cue.text, start: cue.start, len: cue.len, estimated: false, clipped: false }];
    }).sort((a, b) => a.start - b.start || a.captionId.localeCompare(b.captionId) || (a.wordIndex || 0) - (b.wordIndex || 0));
}
export function transcriptRange(tl, selection, trackId = 'all') {
    const entries = transcriptEntries(tl, trackId), first = entries.findIndex(word => word.key === selection?.first), last = entries.findIndex(word => word.key === selection?.last);
    if (first < 0 || last < 0) return { error: 'Select a current transcript word or caption range.' };
    const selected = entries.slice(Math.min(first, last), Math.max(first, last) + 1);
    if (selected.some(word => word.trackId !== selected[0].trackId)) return { error: 'Choose words on one caption track; overlapping transcripts cannot define one cut.' };
    if (selected.some(word => word.estimated || word.clipped)) return { error: 'Use complete source word timestamps for word cuts. Estimated or trimmed word timing needs correction first.' };
    if (selected.some((word, index) => index && word.start < selected[index - 1].start + selected[index - 1].len)) return { error: 'These transcript intervals overlap. Choose one caption track or correct its timings first.' };
    return { start: selected[0].start, end: selected.at(-1).start + selected.at(-1).len, entries: selected };
}
/** Ripple one declared interval through every track. Validate the full atomic result before history receives it. */
export function cutTranscriptRange(tl, selection, trackId = 'all') {
    const problem = validateSequence(tl); if (problem) return { error: problem };
    const range = transcriptRange(tl, selection, trackId); if (range.error) return range;
    const cut = cutSequenceRange(tl, range.start, range.end); if (cut.error) return cut;
    // Existing generic cuts keep full word arrays so visual trims can be undone.
    // A transcript edit removes cut words from its surviving caption pieces as well.
    const originals = new Map(tl.text.map(cue => [cue.id, cue]));
    const text = cut.text.flatMap(cue => {
        const original = originals.get(cue.id);
        if (!cue.caption || !cue.words?.length || (original && original.len === cue.len && original.words === cue.words)) return [cue];
        let clipped = false;
        const words = cue.words.flatMap(word => {
            const start = Math.max(0, word.start), end = Math.min(cue.len, word.start + word.len);
            if (end <= start) return [];
            if (start !== word.start || end !== word.start + word.len) clipped = true;
            return [{ ...word, start, len: end - start }];
        });
        return words.length ? [{ ...cue, words, text: words.map(word => word.text).join(' '), wordsEstimated: clipped || cue.wordsEstimated }] : [];
    });
    const next = { ...cut, text }, error = validateSequence(next);
    return error ? { error } : next;
}
export function correctTranscriptWord(tl, key, text) {
    const entry = transcriptEntries(tl).find(word => word.key === key);
    if (!entry || entry.wordIndex === null) return { error: 'Choose one timed word to correct.' };
    if (typeof text !== 'string' || !text.trim() || text.trim().length > 100 || /[\s\u0000-\u001f\u007f]/.test(text.trim())) return { error: 'Correct one word at a time, up to 100 characters without spaces.' };
    const cue = tl.text.find(item => item.id === entry.captionId), words = cue.words.map((word, index) => index === entry.wordIndex ? { ...word, text: text.trim() } : word);
    return updateSequenceClip(tl, 'text', cue.id, { text: words.map(word => word.text).join(' '), words });
}
export const transcriptText = (tl, trackId = 'all') => tl.text.filter(cue => cue.caption && (trackId === 'all' || cue.trackId === trackId)).sort((a, b) => a.start - b.start).map(cue => cue.text).join('\n');
