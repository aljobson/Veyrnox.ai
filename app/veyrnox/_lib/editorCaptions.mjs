import { inlineWordTiming,parseWordJson,wordTimingProblem,slicedWords } from './editorWords.mjs';
import { slicedAnimation } from './editorAnimation.mjs';
import { sourceFrame, shiftedSpeedKeys } from './editorSpeed.mjs';
import { sliceMaskKeyframes } from './editorMask.mjs';
import { addSequenceText, updateSequenceClip, trackFor } from './editorSequence.mjs';
const MAX_BYTES = 262144;
const clean = text => text.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ').trim();
function seconds(value) {
    const match = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim());
    if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60) return NaN;
    return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4]}`);
}
export function parseCaptions(input, extension = 'srt') {
    if (typeof input !== 'string' || new TextEncoder().encode(input).byteLength > MAX_BYTES) return { error: 'Choose a subtitle file under 256 KiB.' };
    if(extension==='json')return parseWordJson(input);
    const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), cues = [];
    const push = (from, to, words) => { const start = Math.round(from * 30), end = Math.round(to * 30); cues.push({ text: clean(words), start, len: end - start, ...inlineWordTiming(words,from,to,clean) }); };
    if (['srt', 'vtt'].includes(extension)) {
        for (const block of text.split(/\n\s*\n/)) {
            const lines = block.split('\n'), index = lines.findIndex(l => l.includes('-->'));
            if (index < 0) continue;
            const timing = lines[index].match(/^(\S+)\s+-->\s+(\S+)/);
            if (!timing) return { error: 'A subtitle timing line is invalid.' };
            push(seconds(timing[1]), seconds(timing[2]), lines.slice(index + 1).join('\n'));
        }
    } else if (extension === 'ass') {
        let inEvents = false, format = null;
        for (const line of text.split('\n')) {
            if (/^\[/.test(line.trim())) { inEvents = line.trim().toLowerCase() === '[events]'; continue; }
            if (!inEvents) continue;
            if (/^Format:/i.test(line)) { format = line.slice(line.indexOf(':') + 1).split(',').map(s => s.trim().toLowerCase()); continue; }
            if (!/^Dialogue:/i.test(line)) continue;
            if (!format || format.at(-1) !== 'text' || !format.includes('start') || !format.includes('end')) return { error: 'ASS needs an Events Format with Start, End and Text last.' };
            const pieces = line.slice(line.indexOf(':') + 1).split(','), fields = [...pieces.slice(0, format.length - 1), pieces.slice(format.length - 1).join(',')];
            push(seconds(fields[format.indexOf('start')] || ''), seconds(fields[format.indexOf('end')] || ''), fields.at(-1) || '');
        }
    } else if (extension === 'lrc') {
        const stamped = [];
        for (const line of text.split('\n')) for (const stamp of line.matchAll(/\[(\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]/g)) stamped.push({ at: seconds(stamp[1].includes('.') || stamp[1].includes(',') ? stamp[1] : `${stamp[1]}.0`), text: line.replace(/\[[^\]]*\]/g, '') });
        stamped.sort((a, b) => a.at - b.at);
        stamped.forEach((cue, i) => push(cue.at, stamped[i + 1]?.at ?? Math.min(600, cue.at + 3), cue.text));
    } else return { error: 'Choose SRT, VTT, ASS, LRC or word timing JSON.' };
    if (!cues.length || cues.length > 150) return { error: 'Choose a file with 1 to 150 subtitle lines.' };
    if (cues.some(c => !c.text || c.text.length > 1000 || !Number.isInteger(c.start) || c.start < 0 || !Number.isInteger(c.len) || c.len < 1 || c.start + c.len > 18000 || (c.words && (wordTimingProblem({...c,caption:true}) || c.words.some(w=>w.start<0 || w.start+w.len>c.len))))) return { error: 'Subtitle text or timing is outside the 10-minute project.' };
    return { cues: cues.sort((a, b) => a.start - b.start) };
}
export function insertCaptions(tl, cues, trackId) {
    let next = tl;
    for (const cue of cues) { next = addSequenceText(next, { ...cue, trackId, caption: true }); if (next.error) return next; }
    return next;
}
const timestamp = (frame, separator) => {
    const millis = Math.round(frame / 30 * 1000), hours = Math.floor(millis / 3600000), minutes = Math.floor(millis / 60000) % 60, sec = Math.floor(millis / 1000) % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(sec).padStart(2, '0')}${separator}${String(millis % 1000).padStart(3, '0')}`;
};
export function exportCaptions(tl, format = 'srt') {
    const items = tl.text.filter(c => c.caption).sort((a, b) => a.start - b.start);
    return `${format === 'vtt' ? 'WEBVTT\n\n' : ''}${items.map((c, i) => `${format === 'srt' ? `${i + 1}\n` : ''}${timestamp(c.start, format === 'vtt' ? '.' : ',')} --> ${timestamp(c.start + c.len, format === 'vtt' ? '.' : ',')}\n${format==='vtt' && c.words?.length ? c.words.filter(w=>w.start+w.len>0 && w.start<c.len).map(w=>`<${timestamp(c.start+Math.max(0,w.start),'.')}>${w.text}`).join(' ') : c.text}`).join('\n\n')}\n`;
}
/** One source-aligned range cut across unlocked tracks. Tail sources keep their original time. */
export function cutSequenceRange(tl, start, end) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return { error: 'Choose a timed caption range.' };
    if ([...tl.video, ...tl.audio, ...tl.text].some(c => c.start + c.len > start && trackFor(tl, c)?.locked)) return { error: 'Unlock the affected tracks before cutting this range.' };
    const duration = end - start; let seq = tl.seq;
    const result = { ...tl };
    for (const kind of ['video', 'audio', 'text']) result[kind] = tl[kind].flatMap(c => {
        const last = c.start + c.len;
        if (last <= start) return [c];
        if (c.start >= end) return [{ ...c, start: c.start - duration }];
        const pieces = [];
        if (c.start < start) pieces.push({ ...c, len: start - c.start, ...slicedAnimation(c,0), fadeIn: Math.min(c.fadeIn || 0, start - c.start), fadeOut: 0 });
        if (last > end) {
            const offset = end - c.start;
            pieces.push({ ...c, ...(c.speedCurve?{speedCurve:shiftedSpeedKeys(c,offset)}:{}), ...(c.maskKeyframes?{maskKeyframes:sliceMaskKeyframes(c,offset)}:{}), id: pieces.length ? `${kind[0]}${++seq}` : c.id, start, len: last - end, ...(kind !== 'text' ? { in: sourceFrame(c,offset) } : {}), ...slicedAnimation(c,offset), ...slicedWords(c,offset), fadeIn: 0, fadeOut: Math.min(c.fadeOut || 0, last - end) });
        }
        return pieces.map(piece => {
            if (kind === 'text') { const { fadeIn: _in, fadeOut: _out, ...text } = piece; return text; }
            return piece;
        });
    });
    return { ...result, seq };
}
export function applyCaptionStyle(tl, style) {
    let next = tl;
    for (const item of tl.text.filter(c => c.caption)) { next = updateSequenceClip(next, 'text', item.id, { style }); if (next.error) return next; }
    return next;
}
