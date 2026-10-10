import {
    FPS, MAX_FRAMES, addMedia, addVideoClip, addAudioClip, addText, updateText, setVolume,
    videoFrames, audioEnd, videoLayout, trimClip, moveVideoClip, splitClip,
} from './editorTimeline.mjs';

/** Keep a long source available while inserting only the part that fits this edit. */
export function insertMedia(tl, mediaId) {
    const media = tl.media[mediaId];
    if (!media) return { error: 'Add a file first.' };
    const room = MAX_FRAMES - (media.kind === 'video' ? videoFrames(tl) : audioEnd(tl));
    if (room < 1) return { error: 'The timeline is full. Trim or remove a clip to make room.' };
    const len = Math.min(media.frames, room);
    return media.kind === 'video' ? addVideoClip(tl, mediaId, { len }) : addAudioClip(tl, mediaId, { len });
}

export function importMedia(tl, media) {
    if (tl.media[media.id]) return { error: 'That file is already in this project. Add it from the media bin.' };
    const next = addMedia(tl, media);
    if (next.error) return next;
    const inserted = insertMedia(next, media.id);
    // Importing into a full timeline still keeps the file in the bin for later use.
    return inserted.error ? next : inserted;
}

export function duplicateSelection(tl, selection) {
    const { track, id } = selection || {};
    const item = tl[track]?.find(x => x.id === id);
    if (!item) return { error: 'Select a clip or text first.' };
    if (track === 'text') return addText(tl, { ...item, start: Math.min(MAX_FRAMES - item.len, item.start + item.len) });
    let next = track === 'video'
        ? addVideoClip(tl, item.mediaId, { in: item.in, len: item.len })
        : addAudioClip(tl, item.mediaId, { in: item.in, len: item.len, start: item.start + item.len });
    if (next.error) return next;
    const copyId = `${track === 'video' ? 'v' : 'a'}${next.seq}`;
    next = setVolume(next, track, copyId, item.volume);
    return track === 'video' ? moveVideoClip(next, copyId, tl.video.findIndex(c => c.id === id) + 1) : next;
}

/** Extracting sound transfers its volume; leaving it on both tracks would double it at export. */
export function detachAudio(tl, id) {
    const item = videoLayout(tl).find(x => x.clip.id === id);
    if (!item) return { error: 'Select a video first.' };
    let next = addAudioClip(tl, item.clip.mediaId, { start: item.start, in: item.clip.in, len: item.clip.len });
    if (next.error) return next;
    next = setVolume(next, 'audio', `a${next.seq}`, item.clip.volume);
    return setVolume(next, 'video', id, 0);
}

export function splitSelection(tl, selection, frame) {
    const { track, id } = selection || {};
    if (track !== 'text') return splitClip(tl, track, id, frame);
    const item = tl.text.find(x => x.id === id);
    if (!item) return { error: 'Select a text first.' };
    const offset = frame - item.start;
    if (offset < 1 || offset >= item.len) return { error: 'Move the playhead inside the text to split it.' };
    const next = updateText(tl, id, { len: offset });
    return addText(next, { ...item, start: frame, len: item.len - offset });
}

/** Dragging the first edge removes or reveals source frames; the main video lane ripples. */
export function trimEdge(tl, track, id, edge, delta) {
    const item = tl[track]?.find(x => x.id === id);
    if (!item || !Number.isInteger(delta) || !['in', 'out'].includes(edge)) return { error: 'Select a clip or text first.' };
    const len = item.len + (edge === 'in' ? -delta : delta);
    if (track === 'text') return updateText(tl, id, { len, ...(edge === 'in' ? { start: item.start + delta } : {}) });
    return trimClip(tl, track, id, { len, ...(edge === 'in' ? { in: item.in + delta, ...(track === 'audio' ? { start: item.start + delta } : {}) } : {}) });
}

export const stepFrame = (frame, delta, total) => Math.max(0, Math.min(Math.max(0, total - 1), frame + delta));
export const initialText = frame => ({ text: 'Your text', start: Math.min(frame, MAX_FRAMES - 3 * FPS), len: 3 * FPS });

export function removeMedia(tl, id) {
    if (!tl.media[id]) return tl;
    const media = { ...tl.media }; delete media[id];
    return { ...tl, media, video: tl.video.filter(x => x.mediaId !== id), audio: tl.audio.filter(x => x.mediaId !== id) };
}
