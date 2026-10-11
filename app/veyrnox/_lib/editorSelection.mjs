import { cutSequenceRange } from './editorCaptions.mjs';
import { backgroundMediaIds } from './editorBackground.mjs';
import { validateSequence } from './editorSequenceValidation.mjs';
import { trackFor, moveSequence } from './editorSequence.mjs';
const clips = tl => ['video', 'audio', 'text'].flatMap(track => tl[track].map(clip => ({ track, ...clip })));
const checked = tl => { const error = validateSequence(tl); return error ? { error } : tl; };
const locked = (tl, items) => items.some(c => trackFor(tl, c)?.locked);
export const selectionMembers = (tl, selection) => clips(tl).filter(c => selection.some(s => s.id === c.id && s.track === c.track));
export function linkedSelection(tl, selection) {
    const item = tl[selection.track]?.find(c => c.id === selection.id);
    return item?.groupId ? clips(tl).filter(c => c.groupId === item.groupId).map(c => ({ track: c.track, id: c.id })) : [selection];
}
export function groupSelection(tl, selection, group = true) {
    const items = selectionMembers(tl, selection);
    if (!items.length || (group && items.length < 2)) return { error: 'Select two or more clips to group.' };
    if (locked(tl, items)) return { error: 'Unlock every selected track first.' };
    const seq = tl.seq + (group ? 1 : 0), ids = new Set(items.map(c => c.id));
    const next = { ...tl, seq };
    for (const kind of ['video', 'audio', 'text']) next[kind] = tl[kind].map(c => {
        if (!ids.has(c.id)) return c;
        const { groupId: _old, ...rest } = c;
        return group ? { ...rest, groupId: `g${seq}` } : rest;
    });
    return checked(next);
}
export function copySelection(tl, selection) {
    const items = selectionMembers(tl, selection);
    return { items, media: Object.fromEntries(items.filter(c => c.mediaId).flatMap(c => [c.mediaId,...backgroundMediaIds(c)].map(id => [id,tl.media[id]]))) };
}
export function pasteSelection(tl, clipboard, frame) {
    if (!clipboard?.items?.length) return { error: 'Copy clips first.' };
    if (locked(tl, clipboard.items)) return { error: 'Unlock the destination tracks first.' };
    const earliest = Math.min(...clipboard.items.map(c => c.start)), groups = new Map();
    let seq = tl.seq;
    const next = { ...tl, media: { ...tl.media, ...clipboard.media }, video: [...tl.video], audio: [...tl.audio], text: [...tl.text] };
    for (const item of clipboard.items) {
        const { track, groupId, ...clip } = item;
        if (groupId && !groups.has(groupId)) groups.set(groupId, `g${++seq}`);
        next[track].push({ ...clip, id: `${track[0]}${++seq}`, start: Math.round(frame) + clip.start - earliest, ...(groupId ? { groupId: groups.get(groupId) } : {}) });
    }
    return checked({ ...next, seq });
}
export function deleteSelection(tl, selection, ripple = false) {
    const items = selectionMembers(tl, selection);
    if (!items.length) return { error: 'Select clips first.' };
    if (locked(tl, items)) return { error: 'Unlock every selected track first.' };
    const ids = new Set(items.map(c => c.id)), next = { ...tl };
    if(ripple==='all') {
        for(const kind of ['video','audio','text'])next[kind]=tl[kind].filter(c=>!ids.has(c.id));
        const ranges=items.map(c=>[c.start,c.start+c.len]).sort((a,b)=>a[0]-b[0]),merged=[];
        for(const range of ranges){const last=merged.at(-1);if(last && range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}
        let result=next;for(const [from,to] of merged.reverse()){result=cutSequenceRange(result,from,to);if(result.error)return result;}
        return checked(result);
    }
    for (const kind of ['video', 'audio', 'text']) next[kind] = tl[kind].filter(c => !ids.has(c.id)).map(c => {
        if (!ripple) return c;
        // Merge selected ranges first so overlapping clips do not remove the same gap twice.
        const ranges = items.filter(i => i.trackId === c.trackId && i.start + i.len <= c.start).map(i => [i.start, i.start + i.len]).sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const range of ranges) { const last = merged.at(-1); if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]); else merged.push([...range]); }
        return { ...c, start: c.start - merged.reduce((n, [from, to]) => n + to - from, 0) };
    });
    return checked(next);
}
export function moveSelection(tl, selection, primary, at, lane, snap, frame) {
    const items = selectionMembers(tl, selection);
    if (locked(tl, items)) return { error: 'Unlock every selected track first.' };
    const first = items.find(c => c.id === primary.id);
    if (!first) return moveSequence(tl, primary.track, primary.id, at, lane, snap, frame);
    const moved = moveSequence(tl, primary.track, primary.id, at, lane, snap, frame); if (moved.error) return moved;
    const delta = moved[primary.track].find(c => c.id === primary.id).start - first.start;
    const ids = new Set(items.map(c => c.id)), next = { ...moved };
    for (const kind of ['video', 'audio', 'text']) next[kind] = next[kind].map(c => ids.has(c.id) && c.id !== primary.id ? { ...c, start: c.start + delta } : c);
    return checked(next);
}
export function reorderSequenceTrack(tl, id, direction) {
    const tracks = [...tl.tracks], index = tracks.findIndex(t => t.id === id), to = index + direction;
    if (index < 0 || to < 0 || to >= tracks.length) return tl;
    [tracks[index], tracks[to]] = [tracks[to], tracks[index]];
    return checked({ ...tl, tracks });
}
export function trackAudible(tl, item) {
    const track = trackFor(tl, item);
    return !track?.muted && (!tl.tracks?.some(t => t.solo && t.kind !== 'text') || !!track?.solo);
}
