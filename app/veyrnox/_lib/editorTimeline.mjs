import { helperEnglish } from '../../../lib/helperMessages.mjs';
import { sequenceTransition } from './editorSequence.mjs';
import { validateSequence } from './editorSequenceValidation.mjs';
// Browser timeline editor, slice 1 (ADR-0080). Pure model: no React, no network, no browser APIs, so every rule here is unit-testable.
//
// Time is whole FRAMES at the project rate, so there is no floating-point drift to reconcile at export.
// Two tracks: `video` is a SEQUENCE (clips play back to back, no gaps; removing or trimming one closes the gap, like CapCut's magnetic
// track), `audio` is FREE (each clip has a `start` frame; clips may not overlap). A timeline is plain JSON and every operation returns a
// new object (or { error }), never mutating its input. The document shape is versioned so slice 3 can save it as a project document.

export const FPS = 30;
export const SCHEMA_VERSION = 2;
export const LIMITS = Object.freeze({
    maxSeconds: 60, maxVideoClips: 10, maxAudioClips: 10, maxMedia: 24, maxNameLength: 120,
    maxTexts: 10, maxTextChars: 120, minTextSize: 2, maxTextSize: 20, maxTransitionSeconds: 2,
});
/** Output shape: the first clip's own shape, or a preset; anything that does not fit is letterboxed or pillarboxed. */
export const ASPECTS = Object.freeze(['source', '16:9', '9:16', '1:1']);
export const MAX_FRAMES = LIMITS.maxSeconds * FPS;

export function emptyTimeline() {
    return { schemaVersion: SCHEMA_VERSION, fps: FPS, seq: 0, aspect: 'source', media: {}, video: [], audio: [], text: [] };
}

const err = error => ({ error });
const isInt = n => Number.isInteger(n);
export const secondsToFrames = s => Math.round(s * FPS);
export const framesToSeconds = f => f / FPS;

/** Where each video clip sits: the sequence is contiguous, so a clip's start is the sum of the lengths before it. */
export function videoLayout(tl) {
    if (tl.schemaVersion === 3) return tl.video.map(clip => ({ clip, start: clip.start, end: clip.start + clip.len }));
    let at = 0;
    return tl.video.map(clip => { const item = { clip, start: at, end: at + clip.len }; at += clip.len; return item; });
}
export function videoFrames(tl) { return tl.schemaVersion === 3 ? Math.max(0, ...tl.video.map(c => c.start + c.len)) : tl.video.reduce((n, c) => n + c.len, 0); }
export function audioEnd(tl) { return tl.audio.reduce((n, c) => Math.max(n, c.start + c.len), 0); }
/** Text can extend the project too, including a title-only video over black. */
export function totalFrames(tl) { return Math.max(videoFrames(tl), audioEnd(tl), tl.text.reduce((end, x) => Math.max(end, x.start + x.len), 0)); }

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
    if (videoFrames(tl) + length > MAX_FRAMES) return err(helperEnglish('a_project_holds_up_to_seconds', { value1: LIMITS.maxSeconds }));
    const { seq, id } = nextId(tl, 'v');
    return { ...tl, seq, video: [...tl.video, { id, mediaId, in: from, len: length, volume: 1, transition: 0 }] };
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
    if (at + length > MAX_FRAMES) return err(helperEnglish('a_project_holds_up_to_seconds', { value1: LIMITS.maxSeconds }));
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
    const second = { ...clip, id: newId, in: clip.in + offset, len: clip.len - offset, ...(track === 'audio' ? { start: clip.start + offset } : { transition: 0 }) };
    return { ...tl, seq, [track]: [...tl[track].slice(0, i), first, second, ...tl[track].slice(i + 1)] };
}

/** Change which part of the source a clip plays. `in`/`len` are source frames and must stay inside the media. */
export function trimClip(tl, track, id, { in: from, len, start }) {
    const i = find(tl, track, id);
    if (i < 0) return err('Select a clip first.');
    const clip = tl[track][i], media = tl.media[clip.mediaId];
    const nextIn = from ?? clip.in, nextLen = len ?? clip.len;
    if (!isInt(nextIn) || !isInt(nextLen) || nextIn < 0 || nextLen < 1 || nextIn + nextLen > media.frames) return err('That range is outside the clip.');
    if (track === 'audio' && start !== undefined && (!isInt(start) || start < 0)) return err('That range is outside the clip.');
    const next = replace(tl[track], i, { ...clip, in: nextIn, len: nextLen, ...(track === 'audio' && start !== undefined ? { start } : {}) });
    const out = { ...tl, [track]: next };
    if (track === 'video' && videoFrames(out) > MAX_FRAMES) return err(helperEnglish('a_project_holds_up_to_seconds', { value1: LIMITS.maxSeconds }));
    if (track === 'audio' && overlaps(out.audio)) return err('Audio clips cannot overlap.');
    if (track === 'audio' && audioEnd(out) > MAX_FRAMES) return err(helperEnglish('a_project_holds_up_to_seconds', { value1: LIMITS.maxSeconds }));
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
    if (audioEnd(out) > MAX_FRAMES) return err(helperEnglish('a_project_holds_up_to_seconds', { value1: LIMITS.maxSeconds }));
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
    if (doc?.schemaVersion === 3) return validateSequence(doc);
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return helperEnglish('not_a_timeline');
    if (doc.schemaVersion !== SCHEMA_VERSION) return helperEnglish('unsupported_timeline_version');
    if (doc.fps !== FPS) return helperEnglish('only_frames_a_second_is_supported', { value1: FPS });
    if (!isInt(doc.seq) || doc.seq < 0 || doc.seq > 1e6) return helperEnglish('bad_counter');
    if (!ASPECTS.includes(doc.aspect)) return helperEnglish('bad_aspect');
    if (!Array.isArray(doc.text)) return helperEnglish('bad_text_list');
    if (!doc.media || typeof doc.media !== 'object' || Array.isArray(doc.media)) return helperEnglish('bad_media_list');
    if (!Array.isArray(doc.video) || !Array.isArray(doc.audio)) return helperEnglish('bad_tracks');
    const ids = Object.keys(doc.media);
    if (ids.length > LIMITS.maxMedia) return helperEnglish('too_many_files');
    for (const id of ids) {
        const m = doc.media[id];
        if (!m || m.id !== id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return helperEnglish('bad_media_entry');
        if (m.kind !== 'video' && m.kind !== 'audio') return helperEnglish('bad_media_kind');
        if (!isInt(m.frames) || m.frames < 1 || m.frames > 1e7) return helperEnglish('bad_media_length');
        if (typeof m.name !== 'string' || m.name.length > LIMITS.maxNameLength) return helperEnglish('bad_media_name');
        if (typeof m.hasAudio !== 'boolean' || !isInt(m.width) || !isInt(m.height) || m.width < 0 || m.height < 0 || m.width > 16384 || m.height > 16384) return helperEnglish('bad_media_entry');
    }
    if (doc.video.length > LIMITS.maxVideoClips) return helperEnglish('too_many_video_clips');
    if (doc.audio.length > LIMITS.maxAudioClips) return helperEnglish('too_many_audio_clips');
    const seen = new Set();
    const clipError = (c, track) => {
        if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !/^[va][0-9]{1,7}$/.test(c.id) || seen.has(c.id)) return helperEnglish('bad_clip_id');
        seen.add(c.id);
        const m = doc.media[c.mediaId];
        if (!m) return helperEnglish('a_clip_points_at_a_missing_file');
        if (track === 'video' && m.kind !== 'video') return helperEnglish('a_video_clip_points_at_an_audio_file');
        if (track === 'audio' && m.kind === 'video' && !m.hasAudio) return helperEnglish('an_audio_clip_points_at_a_file_with');
        if (!isInt(c.in) || !isInt(c.len) || c.in < 0 || c.len < 1 || c.in + c.len > m.frames) return helperEnglish('a_clip_range_is_outside_its_file');
        if (typeof c.volume !== 'number' || !Number.isFinite(c.volume) || c.volume < 0 || c.volume > 1) return helperEnglish('bad_volume');
        if (track === 'audio' && (!isInt(c.start) || c.start < 0)) return helperEnglish('bad_audio_start');
        if (track === 'video' && (!isInt(c.transition) || c.transition < 0 || c.transition > MAX_TRANSITION)) return helperEnglish('bad_transition');
        return null;
    };
    for (const c of doc.video) { const e = clipError(c, 'video'); if (e) return e; }
    for (const c of doc.audio) { const e = clipError(c, 'audio'); if (e) return e; }
    if (overlaps(doc.audio)) return helperEnglish('audio_clips_overlap');
    if (doc.text.length > LIMITS.maxTexts) return helperEnglish('too_many_texts');
    for (const x of doc.text) {
        if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !/^t[0-9]{1,7}$/.test(x.id) || seen.has(x.id)) return helperEnglish('bad_text_id');
        seen.add(x.id);
        if (textError(x)) return textError(x);
    }
    if (totalFrames(doc) > MAX_FRAMES) return helperEnglish('a_project_holds_up_to_seconds', { value1: LIMITS.maxSeconds });
    return null;
}

// ---- Slice 2 (ADR-0080): aspect presets, crossfade transitions and on-canvas text. ----

export const MAX_TRANSITION = LIMITS.maxTransitionSeconds * FPS;

export function setAspect(tl, aspect) {
    return ASPECTS.includes(aspect) ? { ...tl, aspect } : err('Choose a shape from the list.');
}

/**
 * A crossfade on video clip k dissolves it in over the END of clip k-1 (which keeps playing underneath, past its out point when the
 * file has more, else on its last frame). The sequence timing does not change. Stored on the clip; the length that applies is clamped
 * here so a later trim, move or delete can never make it read outside either clip.
 */
export function effectiveTransition(tl, k) {
    if (tl.schemaVersion === 3) return sequenceTransition(tl, k);
    if (k < 1 || k >= tl.video.length) return 0;
    const clip = tl.video[k], prev = tl.video[k - 1];
    return Math.max(0, Math.min(clip.transition || 0, clip.len, prev.len, MAX_TRANSITION));
}

export function setTransition(tl, id, frames) {
    const i = find(tl, 'video', id);
    if (i < 0) return err('Select a clip first.');
    if (i === 0) return err('The first clip has nothing to dissolve from.');
    if (!isInt(frames) || frames < 0 || frames > MAX_TRANSITION) return err(`A dissolve is up to ${LIMITS.maxTransitionSeconds} seconds.`);
    if (frames > Math.min(tl.video[i].len, tl.video[i - 1].len)) return err('A dissolve cannot be longer than either clip.');
    return { ...tl, video: replace(tl.video, i, { ...tl.video[i], transition: frames }) };
}

const CONTROL_RE = /[\u0000-\u001f\u007f\u2028\u2029]/;
/** Why a text item is unusable, or null. Text is drawn on a canvas and never put into the page, so its content needs no escaping. */
function textError(x) {
    if (typeof x.text !== 'string' || x.text.length < 1 || x.text.length > LIMITS.maxTextChars || CONTROL_RE.test(x.text)) return helperEnglish('text_is_1_to_120_characters_on_one');
    if (!isInt(x.start) || !isInt(x.len) || x.start < 0 || x.len < 1 || x.start + x.len > MAX_FRAMES) return helperEnglish('text_timing_is_outside_the_project');
    if (typeof x.x !== 'number' || typeof x.y !== 'number' || !(x.x >= 0 && x.x <= 1 && x.y >= 0 && x.y <= 1)) return helperEnglish('text_position_is_off_the_picture');
    if (!isInt(x.size) || x.size < LIMITS.minTextSize || x.size > LIMITS.maxTextSize) return helperEnglish('text_size_is_2_to_20');
    return null;
}

/** Add a caption: `start`/`len` in frames, `x`/`y` as a fraction of the picture, `size` as a percentage of its height. */
export function addText(tl, { text, start = 0, len = 3 * FPS, x = 0.5, y = 0.85, size = 6 } = {}) {
    if (tl.text.length >= LIMITS.maxTexts) return err(`A project holds up to ${LIMITS.maxTexts} texts.`);
    const item = { text: typeof text === 'string' ? text.trim() : '', start, len, x, y, size };
    const bad = textError(item);
    if (bad) return err(bad);
    const { seq, id } = nextId(tl, 't');
    return { ...tl, seq, text: [...tl.text, { id, ...item }] };
}

export function updateText(tl, id, patch) {
    const i = tl.text.findIndex(x => x.id === id);
    if (i < 0) return err('Select a text first.');
    const allowed = ['text', 'start', 'len', 'x', 'y', 'size'];
    const next = { ...tl.text[i] };
    for (const key of Object.keys(patch || {})) if (allowed.includes(key)) next[key] = key === 'text' && typeof patch.text === 'string' ? patch.text.trim() : patch[key];
    const bad = textError(next);
    if (bad) return err(bad);
    return { ...tl, text: replace(tl.text, i, next) };
}

export function removeText(tl, id) {
    return tl.text.some(x => x.id === id) ? { ...tl, text: tl.text.filter(x => x.id !== id) } : err('Select a text first.');
}

/** The texts showing on timeline frame `i`. */
export function textsAt(tl, i) { return tl.text.filter(x => i >= x.start && i < x.start + x.len); }

/** "0:07.4" style label for a frame count. */
export function formatTime(frames) {
    const s = Math.max(0, frames) / FPS;
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
