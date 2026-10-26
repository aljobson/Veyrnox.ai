import { validateTimeline, totalFrames, videoLayout, effectiveTransition } from '../app/veyrnox/_lib/editorTimeline.mjs';

export const DURATION_LIMITS = Object.freeze({ '1080p': 120, '720p': 300 });
export const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
const unsupported = feature => ({ error: 'editor_render_unsupported', feature });
const ref = name => ({ $ref: name });
const extra = (value, keys) => Object.keys(value).find(k => !keys.includes(k));

/** Pure call plan. $ref values name results captured by the runner, never executable code. */
export function translateEditorRender(tl, { resolution = '1080p' } = {}) {
    if (!tl || ![2, 3].includes(tl.schemaVersion)) return unsupported('schemaVersion');
    if (['video', 'audio', 'text'].some(k => !Array.isArray(tl[k]) || tl[k].some(c => !c || typeof c !== 'object' || Array.isArray(c)))) return { error: 'editor_render_invalid_document' };
    // Check feature names before schema validation so unsupported edits have a stable public error.
    for (const c of [...(tl.video || []), ...(tl.audio || [])]) {
        if (c.transitionType !== undefined && c.transitionType !== 'dissolve') return unsupported('transitionType');
        const key = extra(c, ['id', 'mediaId', 'in', 'len', 'volume', 'transition', 'start', 'trackId', 'transitionType']);
        if (key) return unsupported(key);
    }
    for (const t of tl.text || []) {
        const key = extra(t, ['id', 'text', 'start', 'len', 'x', 'y', 'size', 'trackId']);
        if (key) return unsupported(`text.${key}`);
        if (t.x !== 0.5) return unsupported('text.x');
    }
    if (validateTimeline(tl)) return { error: 'editor_render_invalid_document' };
    const unknown = extra(tl, ['schemaVersion', 'fps', 'seq', 'aspect', 'media', 'video', 'audio', 'text', 'tracks', 'background', 'folders', 'markers']);
    if (unknown) return unsupported(unknown);
    if (tl.schemaVersion === 3) {
        if (tl.background.toLowerCase() !== '#000000') return unsupported('background');
        for (const kind of ['video', 'audio', 'text']) {
            if (tl.tracks.filter(t => t.kind === kind).length !== 1) return unsupported('multiple_tracks');
        }
        if (tl.tracks.some(t => t.muted || t.hidden || t.solo)) return unsupported('track_visibility');
        for (const kind of ['video', 'audio', 'text']) {
            const clips = [...tl[kind]].sort((a, b) => a.start - b.start);
            if (clips.some((c, i) => i && c.start < clips[i - 1].start + clips[i - 1].len)) return unsupported('overlapping_clips');
        }
    }
    for (const m of Object.values(tl.media)) {
        if (!['video', 'audio'].includes(m.kind)) return unsupported(`media.${m.kind}`);
        const key = extra(m, ['id', 'kind', 'frames', 'name', 'hasAudio', 'width', 'height', 'folder', 'sourceName', 'attribution']);
        if (key) return unsupported(`media.${key}`);
    }
    const seconds = totalFrames(tl) / tl.fps;
    if (!DURATION_LIMITS[resolution] || seconds <= 0 || seconds > DURATION_LIMITS[resolution]) return { error: 'editor_render_duration_limit' };
    let aspect = tl.aspect;
    const first = tl.media[tl.video[0]?.mediaId];
    if (aspect === 'source') {
        if (!first?.width || !first?.height) return unsupported('source_aspect');
        aspect = ['16:9', '9:16', '1:1'].find(a => { const [w, h] = a.split(':').map(Number); return first.width * h === first.height * w; });
        if (!aspect) return unsupported('source_aspect');
    }
    const edge = resolution === '720p' ? 720 : 1080;
    const [width, height] = aspect === '16:9' ? [edge * 16 / 9, edge] : aspect === '9:16' ? [edge, edge * 16 / 9] : [edge, edge];
    const calls = [];
    const call = (method, params, capture) => calls.push({ method, params, ...(capture ? { capture } : {}) });
    const apply = (command, capture) => call('edit.apply', { path: ref('path'), command }, capture);
    call('project.create', { location: ref('location'), name: 'project', video: { width, height, rateNum: tl.fps, rateDen: 1 } }, 'project');
    Object.values(tl.media).forEach(m => call('media.import', { path: ref('path'), file: ref(`file:${m.id}`) }, `media:${m.id}`));
    const place = (c, kind, start) => {
        const id = `clip:${c.id}`, trackId = ref(`track:${kind}`);
        apply({ op: 'addClip', mediaId: ref(`media:${c.mediaId}`), trackId, start: 0, ripple: false }, id);
        if (c.in > 0) apply({ op: 'trimClip', clipId: ref(id), edge: 'start', delta: c.in / tl.fps });
        const tail = tl.media[c.mediaId].frames - c.in - c.len;
        if (tail > 0) apply({ op: 'trimClip', clipId: ref(id), edge: 'end', delta: -tail / tl.fps });
        apply({ op: 'moveClips', moves: [{ clipId: ref(id), start: start / tl.fps, trackId }] });
        if (c.volume !== 1) apply({ op: 'updateClip', clipId: ref(id), patch: { volume: c.volume } });
    };
    for (const { clip: c, start } of videoLayout(tl).sort((a, b) => a.start - b.start)) {
        const i = tl.video.indexOf(c);
        place(c, 'video', start);
        const transition = effectiveTransition(tl, i);
        if (transition) apply({ op: 'updateClip', clipId: ref(`clip:${c.id}`), patch: { transitionIn: { id: 'concat.dissolve', duration: transition / tl.fps } } });
    }
    for (const c of [...tl.audio].sort((a, b) => a.start - b.start)) place(c, 'audio', c.start);
    for (const t of [...tl.text].sort((a, b) => a.start - b.start)) apply({ op: 'addTextClip', above: true, start: t.start / tl.fps, duration: t.len / tl.fps, offsetY: t.y - 0.5,
        style: { content: t.text, fontSize: t.size / 100, fontFamily: 'DejaVu Sans', fontWeight: 700, italic: false, color: '#ffffff', strokeWidth: 0, shadow: true } });
    call('export.run', { path: ref('path'), output: ref('output'), width, height });
    return { calls, seconds, width, height, resolution };
}
