import { insertCaptions } from './editorCaptions.mjs';
import { validateSequence } from './editorSequenceValidation.mjs';
const normalized = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const lyricSourceCaptions = tl => tl.text.filter(c => c.caption && c.wordsEstimated === false && c.words?.length);
/** Match existing timestamps only. Missing or ambiguous words never receive invented timings. */
export function alignLyricCaptions(tl, input, sourceId = 'all') {
    const problem = validateSequence(tl); if (problem) return {error:problem};
    if (typeof input !== 'string' || new TextEncoder().encode(input).byteLength > 16384 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(input)) return {error:'Use lyrics under 16 KiB without control characters.'};
    const lines = input.trim().split(/\r?\n/).map(line => line.trim().replace(/\s+/g, ' ')).filter(Boolean);
    if (!lines.length || lines.length > 150 || lines.some(line => line.length > 1000 || line.split(' ').length > 100)) return {error:'Use 1–150 lyric lines, with up to 100 words and 1000 characters per line.'};
    const tokens = lines.flatMap((text,line) => text.split(' ').map(word => ({text:word, key:normalized(word), line})));
    if (tokens.length > 1000 || tokens.some(token => !token.key)) return {error:'Use up to 1000 lyric words; attach punctuation to its word.'};
    const sources = lyricSourceCaptions(tl).filter(c => sourceId === 'all' || c.id === sourceId);
    if (!sources.length) return {error:'Import word timestamps or create local automatic captions first. Evenly distributed timings cannot align lyrics.'};
    const trackId = sources[0].trackId;
    if (sources.some(c => c.trackId !== trackId)) return {error:'Choose one timed caption or keep the timed source on one text track.'};
    if (tl.tracks.find(t => t.id === trackId)?.locked) return {error:'Unlock the source caption track before aligning lyrics.'};
    if (sources.some(c => c.words.some(w => /\s/.test(w.text.trim()) || !normalized(w.text) || w.start < 0 || w.start + w.len > c.len))) return {error:'The source needs one complete timestamp per word. Adjust trimmed words or import word timing JSON.'};
    const words = sources.flatMap(c => c.words.map(w => ({...w, start:c.start + w.start, key:normalized(w.text), source:c}))).sort((a,b) => a.start - b.start);
    if (words.some((w,i) => i && w.start < words[i-1].start + words[i-1].len)) return {error:'Source word timestamps overlap. Choose one timed caption or correct its timings.'};
    const first = []; let cursor = 0;
    for (const token of tokens) {
        while (cursor < words.length && words[cursor].key !== token.key) cursor++;
        if (cursor === words.length) return {error:`No ordered word timestamp matches “${token.text.slice(0,80)}”. Correct the source transcript or lyrics first.`};
        first.push(cursor++);
    }
    cursor = words.length - 1;
    for (let i = tokens.length - 1; i >= 0; i--) {
        while (cursor >= 0 && words[cursor].key !== tokens[i].key) cursor--;
        if (cursor !== first[i]) return {error:'Repeated words have more than one possible alignment. Choose one timed caption or include more surrounding lyrics.'};
        cursor--;
    }
    const cues = lines.map((text,line) => {
        const matched = tokens.flatMap((token,i) => token.line === line ? [{...words[first[i]], text:token.text}] : []);
        const start = matched[0].start, source = matched[0].source;
        return {text, start, len:matched.at(-1).start + matched.at(-1).len - start, trackId,
            x:source.x, y:source.y, size:source.size, ...(source.style ? {style:source.style} : {}),
            words:matched.map(w => ({text:w.text, start:w.start - start, len:w.len})), wordsEstimated:false,
            wordStyle:{mode:'karaoke', color:'#ffe66d'}};
    });
    const replaced = new Set(sources.map(c => c.id));
    return insertCaptions({...tl, text:tl.text.filter(c => !replaced.has(c.id))}, cues, trackId);
}
