// Browser timeline editor, slice 1 (ADR-0080). Pure model: no React, no network, no browser APIs, so every rule here is unit-testable.
//
// Time is whole FRAMES at the project rate, so there is no floating-point drift to reconcile at export.
// Two tracks: `video` is a SEQUENCE (clips play back to back, no gaps; removing or trimming one closes the gap, like CapCut's magnetic
// track), `audio` is FREE (each clip has a `start` frame; clips may not overlap). A timeline is plain JSON and every operation returns a
// new object (or { error }), never mutating its input. The document shape is versioned so slice 3 can save it as a project document.

export const FPS = 30;
export const SCHEMA_VERSION = 1;
export const LIMITS = Object.freeze({
    maxSeconds: 60, maxVideoClips: 10, maxAudioClips: 10, maxMedia: 24, maxNameLength: 120,
});
export const MAX_FRAMES = LIMITS.maxSeconds * FPS;

export function emptyTimeline() {
    return { schemaVersion: SCHEMA_VERSION, fps: FPS, seq: 0, media: {}, video: [], audio: [] };
}

const err = error => ({ error });
const isInt = n => Number.isInteger(n);
export const secondsToFrames = s => Math.round(s * FPS);
export const framesToSeconds = f => f / FPS;

/** Where each video clip sits: the sequence is contiguous, so a clip's start is the sum of the lengths before it. */
export function videoLayout(tl) {
    let at = 0;
    return tl.video.map(clip => { const item = { clip, start: at, end: at + clip.len }; at += clip.len; return item; });
}
export function videoFrames(tl) { return tl.video.reduce((n, c) => n + c.len, 0); }
export function audioEnd(tl) { return tl.audio.reduce((n, c) => Math.max(n, c.start + c.len), 0); }
/** The project is as long as the video, or the audio if that runs longer (a music bed past the last clip plays over black). */
export function totalFrames(tl) { return Math.max(videoFrames(tl), audioEnd(tl)); }

export function videoClipAt(tl, frame) {
    return videoLayout(tl).find(item => frame >= item.start && frame < item.end) || null;
}

function nextId(tl, prefix) { const seq = tl.seq + 1; return { seq, id: `${prefix}${seq}` }; }

export function addMedia(tl, media) {
    if (!media || typeof media.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(media.id)) return err('Bad media id.');
    if (media.kind !== 'video' && media.kind !== 'audio') return err('Media must be video or audio.');
    if (!isInt(media.frames) || media.frames < 1) return err('That file has no usable length.');
    if (tl.media[media.id]) return tl;
    if (Object.keys(tl.media).length >= LIMITS.maxMedia) return err(`A project holds up to ${LIMITS.maxMedia} files.`);
    const clean = {
        id: media.id, kind: media.kind, frames: media.frames, name: String(media.name || 'Untitled').slice(0, LIMITS.maxNameLength),
        hasAudio: !!media.hasAudio, width: isInt(media.width) ? media.width : 0, height: isInt(media.height) ? media.height : 0,
    };
    return { ...tl, media: { ...tl.media, [media.id]: clean } };
}

export function addVideoClip(tl, mediaId, { in: from = 0, len } = {}) {
    const media = tl.media[mediaId];
    if (!media || media.kind !== 'video') return err('Add a video file first.');
    const length = len ?? media.frames - from;
    if (!isInt(from) || !isInt(length) || from < 0 || length < 1 || from + length > media.frames) return err('That range is outside the clip.');
    if (tl.video.length >= LIMITS.maxVideoClips) return err(`A project holds up to ${LIMITS.maxVideoClips} video clips.`);
    if (videoFrames(tl) + length > MAX_FRAMES) return err(`A project holds up to ${LIMITS.maxSeconds} seconds.`);
    const { seq, id } = nextId(tl, 'v');
    return { ...tl, seq, video: [...tl.video, { id, mediaId, in: from, len: length, volume: 1 }] };
}

/** Audio goes at `start`, or at the first free frame at or after it. */
export function addAudioClip(tl, mediaId, { start = 0, in: from = 0, len } = {}) {
    const media = tl.media[mediaId];
    if (!media || (media.kind !== 'audio' && !(media.kind === 'video' && media.hasAudio))) return err('That file has no audio.');
    const length = len ?? media.frames - from;
    if (!isInt(start) || !isInt(from) || !isInt(length) || start < 0 || from < 0 || length < 1 || from + length > media.frames) return err('That range is outside the clip.');
    if (tl.audio.length >= LIMITS.maxAudioClips) return err(`A project holds up to ${LIMITS.maxAudioClips} audio clips.`);
    let at = start;
    for (const c of [...tl.audio].sort((a, b) => a.start - b.start)) if (at < c.start + c.len && at + length > c.start) at = c.start + c.len;
    if (at + length > MAX_FRAMES) return err(`A project holds up to ${LIMITS.maxSeconds} seconds.`);
    const { seq, id } = nextId(tl, 'a');
    return { ...tl, seq, audio: [...tl.audio, { id, mediaId, start: at, in: from, len: length, volume: 1 }] };
}

const find = (tl, track, id) => tl[track].findIndex(c => c.id === id);
const replace = (list, i, clip) => list.map((c, k) => (k === i ? clip : c));

/** Split at a TIMELINE frame. The cut must fall strictly inside the clip, so neither half is empty. */
export function splitClip(tl, track, id, frame) {
    const i = find(tl, track, id);
    if (i < 0 || !isInt(frame)) return err('Select a clip first.');
    const clip = tl[track][i];
    const start = track === 'video' ? videoLayout(tl)[i].start : clip.start;
    const offset = frame - start;
    if (offset < 1 || offset > clip.len - 1) return err('Move the playhead inside the clip to split it.');
    if (track === 'video' && tl.video.length >= LIMITS.maxVideoClips) return err(`A project holds up to ${LIMITS.maxVideoClips} video clips.`);
    if (track === 'audio' && tl.audio.length >= LIMITS.maxAudioClips) return err(`A project holds up to ${LIMITS.maxAudioClips} audio clips.`);
    const { seq, id: newId } = nextId(tl, track === 'video' ? 'v' : 'a');
    const first = { ...clip, len: offset };
    const second = { ...clip, id: newId, in: clip.in + offset, len: clip.len - offset, ...(track === 'audio' ? { start: clip.start + offset } : {}) };
    return { ...tl, seq, [track]: [...tl[track].slice(0, i), first, second, ...tl[track].slice(i + 1)] };
}

/** Change which part of the source a clip plays. `in`/`len` are source frames and must stay inside the media. */
export function trimClip(tl, track, id, { in: from, len }) {
    const i = find(tl, track, id);
    if (i < 0) return err('Select a clip first.');
    const clip = tl[track][i], media = tl.media[clip.mediaId];
    const nextIn = from ?? clip.in, nextLen = len ?? clip.len;
    if (!isInt(nextIn) || !isInt(nextLen) || nextIn < 0 || nextLen < 1 || nextIn + nextLen > media.frames) return err('That range is outside the clip.');
    const next = replace(tl[track], i, { ...clip, in: nextIn, len: nextLen });
    const out = { ...tl, [track]: next };
    if (track === 'video' && videoFrames(out) > MAX_FRAMES) return err(`A project holds up to ${LIMITS.maxSeconds} seconds.`);
    if (track === 'audio' && overlaps(out.audio)) return err('Audio clips cannot overlap.');
    if (track === 'audio' && audioEnd(out) > MAX_FRAMES) return err(`A project holds up to ${LIMITS.maxSeconds} seconds.`);
    return out;
}

function overlaps(list) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    return sorted.some((c, k) => k > 0 && c.start < sorted[k - 1].start + sorted[k - 1].len);
}

export function removeClip(tl, track, id) {
    const i = find(tl, track, id);
    return i < 0 ? err('Select a clip first.') : { ...tl, [track]: tl[track].filter(c => c.id !== id) };
}

export function setVolume(tl, track, id, volume) {
    const i = find(tl, track, id);
    if (i < 0) return err('Select a clip first.');
    if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) return err('Volume is between 0 and 100%.');
    return { ...tl, [track]: replace(tl[track], i, { ...tl[track][i], volume: Math.round(volume * 100) / 100 }) };
}

/** Reorder in the video sequence: the clip ends up at index `to`. */
export function moveVideoClip(tl, id, to) {
    const i = find(tl, 'video', id);
    if (i < 0 || !isInt(to) || to < 0 || to >= tl.video.length) return err('Select a clip first.');
    const list = [...tl.video];
    const [clip] = list.splice(i, 1);
    list.splice(to, 0, clip);
    return { ...tl, video: list };
}

export function moveAudioClip(tl, id, start) {
    const i = find(tl, 'audio', id);
    if (i < 0 || !isInt(start) || start < 0) return err('Select a clip first.');
    const out = { ...tl, audio: replace(tl.audio, i, { ...tl.audio[i], start }) };
    if (overlaps(out.audio)) return err('Audio clips cannot overlap.');
    if (audioEnd(out) > MAX_FRAMES) return err(`A project holds up to ${LIMITS.maxSeconds} seconds.`);
    return out;
}

/** Drop media no clip uses, so removing the last clip of a file frees its slot. */
export function pruneMedia(tl) {
    const used = new Set([...tl.video, ...tl.audio].map(c => c.mediaId));
    return { ...tl, media: Object.fromEntries(Object.entries(tl.media).filter(([id]) => used.has(id))) };
}

/**
 * Validate an UNTRUSTED timeline document (a saved project, a pasted file): returns null when it is sound, otherwise a short reason.
 * Never repairs. Every number must be a whole, finite, in-range value and every clip must point at known media.
 */
export function validateTimeline(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'Not a timeline.';
    if (doc.schemaVersion !== SCHEMA_VERSION) return 'Unsupported timeline version.';
    if (doc.fps !== FPS) return `Only ${FPS} frames a second is supported.`;
    if (!isInt(doc.seq) || doc.seq < 0 || doc.seq > 1e6) return 'Bad counter.';
    if (!doc.media || typeof doc.media !== 'object' || Array.isArray(doc.media)) return 'Bad media list.';
    if (!Array.isArray(doc.video) || !Array.isArray(doc.audio)) return 'Bad tracks.';
    const ids = Object.keys(doc.media);
    if (ids.length > LIMITS.maxMedia) return 'Too many files.';
    for (const id of ids) {
        const m = doc.media[id];
        if (!m || m.id !== id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return 'Bad media entry.';
        if (m.kind !== 'video' && m.kind !== 'audio') return 'Bad media kind.';
        if (!isInt(m.frames) || m.frames < 1 || m.frames > 1e7) return 'Bad media length.';
        if (typeof m.name !== 'string' || m.name.length > LIMITS.maxNameLength) return 'Bad media name.';
        if (typeof m.hasAudio !== 'boolean' || !isInt(m.width) || !isInt(m.height) || m.width < 0 || m.height < 0 || m.width > 16384 || m.height > 16384) return 'Bad media entry.';
    }
    if (doc.video.length > LIMITS.maxVideoClips) return 'Too many video clips.';
    if (doc.audio.length > LIMITS.maxAudioClips) return 'Too many audio clips.';
    const seen = new Set();
    const clipError = (c, track) => {
        if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !/^[va][0-9]{1,7}$/.test(c.id) || seen.has(c.id)) return 'Bad clip id.';
        seen.add(c.id);
        const m = doc.media[c.mediaId];
        if (!m) return 'A clip points at a missing file.';
        if (track === 'video' && m.kind !== 'video') return 'A video clip points at an audio file.';
        if (track === 'audio' && m.kind === 'video' && !m.hasAudio) return 'An audio clip points at a file with no audio.';
        if (!isInt(c.in) || !isInt(c.len) || c.in < 0 || c.len < 1 || c.in + c.len > m.frames) return 'A clip range is outside its file.';
        if (typeof c.volume !== 'number' || !Number.isFinite(c.volume) || c.volume < 0 || c.volume > 1) return 'Bad volume.';
        if (track === 'audio' && (!isInt(c.start) || c.start < 0)) return 'Bad audio start.';
        return null;
    };
    for (const c of doc.video) { const e = clipError(c, 'video'); if (e) return e; }
    for (const c of doc.audio) { const e = clipError(c, 'audio'); if (e) return e; }
    if (overlaps(doc.audio)) return 'Audio clips overlap.';
    if (totalFrames(doc) > MAX_FRAMES) return `A project holds up to ${LIMITS.maxSeconds} seconds.`;
    return null;
}

/** "0:07.4" style label for a frame count. */
export function formatTime(frames) {
    const s = Math.max(0, frames) / FPS;
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
