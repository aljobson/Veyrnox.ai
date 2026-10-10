const object = v => v && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const only = (v, keys) => object(v) && Object.keys(v).every(k => keys.includes(k));
const number = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const int = (n, min, max) => Number.isInteger(n) && number(n, min, max);
const colour = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
export const TRANSFORM_DEFAULTS = Object.freeze({ x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, flipX: false, flipY: false });
export const FILTER_DEFAULTS = Object.freeze({ brightness: 1, contrast: 1, saturate: 1, hue: 0, blur: 0 });
export const TEXT_DEFAULTS = Object.freeze({ color: '#ffffff', background: '#000000', backgroundOpacity: 0, stroke: '#000000', strokeWidth: 2, weight: 'bold', font: 'sans-serif', align: 'center' });
export const BLENDS = Object.freeze(['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference']);
export const ANIMATIONS = Object.freeze(['none', 'fade', 'slide-left', 'slide-up', 'zoom']);
export function visualProblem(c) {
    if (c.transform !== undefined && (!exact(c.transform, Object.keys(TRANSFORM_DEFAULTS)) || !number(c.transform.x, -2, 3) || !number(c.transform.y, -2, 3) || !number(c.transform.scale, 0.05, 8) || !number(c.transform.rotation, -360, 360) || !number(c.transform.opacity, 0, 1) || typeof c.transform.flipX !== 'boolean' || typeof c.transform.flipY !== 'boolean')) return 'Invalid transform.';
    if (c.filter !== undefined && (!exact(c.filter, Object.keys(FILTER_DEFAULTS)) || !number(c.filter.brightness, 0, 3) || !number(c.filter.contrast, 0, 3) || !number(c.filter.saturate, 0, 3) || !number(c.filter.hue, -180, 180) || !number(c.filter.blur, 0, 30))) return 'Invalid colour adjustment.';
    if (c.crop !== undefined && (!exact(c.crop, ['x', 'y', 'width', 'height']) || !number(c.crop.x, 0, 1) || !number(c.crop.y, 0, 1) || !number(c.crop.width, 0.05, 1) || !number(c.crop.height, 0.05, 1) || c.crop.x + c.crop.width > 1.000001 || c.crop.y + c.crop.height > 1.000001)) return 'Crop is outside the picture.';
    if (c.effect !== undefined && (!exact(c.effect, ['type', 'intensity']) || !['none', 'vignette', 'pixelate', 'grain'].includes(c.effect.type) || !number(c.effect.intensity, 0, 1))) return 'Invalid effect.';
    if (c.transitionType !== undefined && !['dissolve', 'dip-black', 'wipe-left', 'slide', 'zoom'].includes(c.transitionType)) return 'Invalid transition type.';
    if (c.mask !== undefined && !['none', 'circle', 'rounded', 'horizontal', 'vertical'].includes(c.mask)) return 'Invalid mask.';
    if (c.blend !== undefined && !BLENDS.includes(c.blend)) return 'Invalid blend mode.';
    if (c.fit !== undefined && !['contain', 'cover'].includes(c.fit)) return 'Invalid picture fit.';
    if (c.animation !== undefined && (!exact(c.animation, ['in', 'out', 'duration']) || !ANIMATIONS.includes(c.animation.in) || !ANIMATIONS.includes(c.animation.out) || !int(c.animation.duration, 1, 120))) return 'Invalid animation.';
    if (c.keyframes !== undefined && (!Array.isArray(c.keyframes) || c.keyframes.length > 40 || c.keyframes.some((k, i) => !exact(k, ['frame', 'x', 'y', 'scale', 'rotation', 'opacity', 'easing']) || !int(k.frame, 0, c.len - 1) || (i > 0 && k.frame <= c.keyframes[i - 1].frame) || !number(k.x, -2, 3) || !number(k.y, -2, 3) || !number(k.scale, 0.05, 8) || !number(k.rotation, -360, 360) || !number(k.opacity, 0, 1) || !['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(k.easing)))) return 'Invalid keyframes.';
    return null;
}
export function validateSequence(tl) {
    if (!exact(tl, ['schemaVersion', 'fps', 'seq', 'aspect', 'media', 'video', 'audio', 'text', 'tracks', 'background'])) return 'Invalid multitrack document.';
    if (tl.schemaVersion !== 3 || tl.fps !== 30 || !int(tl.seq, 0, 1e6) || !['source', '16:9', '9:16', '1:1'].includes(tl.aspect) || !colour(tl.background)) return 'Invalid project settings.';
    if (!object(tl.media) || Object.keys(tl.media).length > 40) return 'A project holds up to 40 files.';
    for (const [id, m] of Object.entries(tl.media)) {
        if (!exact(m, ['id', 'kind', 'frames', 'name', 'hasAudio', 'width', 'height', ...(m.graphic !== undefined ? ['graphic'] : [])]) || id !== m.id || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || !['video', 'audio', 'image', 'graphic'].includes(m.kind) || !int(m.frames, 1, 1e7) || typeof m.name !== 'string' || m.name.length > 120 || typeof m.hasAudio !== 'boolean' || !int(m.width, 0, 16384) || !int(m.height, 0, 16384)) return 'Invalid media entry.';
        if (m.kind === 'graphic' && (!exact(m.graphic, ['shape', 'color']) || !['circle', 'rectangle', 'triangle', 'star', 'arrow'].includes(m.graphic.shape) || !colour(m.graphic.color) || m.hasAudio)) return 'Invalid graphic.';
        if (m.kind !== 'graphic' && m.graphic !== undefined) return 'Invalid graphic media.';
    }
    if (!Array.isArray(tl.tracks) || tl.tracks.length < 3 || tl.tracks.length > 16) return 'A project holds up to 16 tracks.';
    const lanes = new Map();
    for (const t of tl.tracks) {
        if (!exact(t, ['id', 'kind', 'name', 'locked', 'muted', 'hidden', ...(t.solo !== undefined ? ['solo'] : [])]) || typeof t.id !== 'string' || !/^(video|audio|text)-[0-9]{1,7}$/.test(t.id) || lanes.has(t.id) || !['video', 'audio', 'text'].includes(t.kind) || typeof t.name !== 'string' || !t.name.trim() || t.name.length > 40 || [t.locked, t.muted, t.hidden].some(v => typeof v !== 'boolean') || (t.solo !== undefined && typeof t.solo !== 'boolean')) return 'Invalid track.';
        lanes.set(t.id, t);
    }
    if (['video', 'audio', 'text'].some(kind => !tl.tracks.some(t => t.kind === kind))) return 'Keep a video, audio and text track.';
    const seen = new Set();
    for (const [kind, max] of [['video', 40], ['audio', 40], ['text', 150]]) {
        if (!Array.isArray(tl[kind]) || tl[kind].length > max) return `Too many ${kind} clips.`;
        for (const c of tl[kind]) {
            const common = ['id', 'start', 'len', 'trackId', 'animation', 'keyframes', 'groupId'];
            const allowed = kind === 'text' ? [...common, 'text', 'x', 'y', 'size', 'style', 'caption'] : [...common, 'mediaId', 'in', 'volume', 'transition', 'rate', 'fadeIn', 'fadeOut', 'pan', 'eq', 'transform', 'filter', 'crop', 'mask', 'blend', 'fit', 'effect', 'transitionType'];
            if (!only(c, allowed) || typeof c.id !== 'string' || !new RegExp(`^${kind[0]}[0-9]{1,7}$`).test(c.id) || seen.has(c.id)) return 'Invalid clip id.';
            seen.add(c.id);
            if (c.groupId !== undefined && !/^g[0-9]{1,7}$/.test(c.groupId)) return 'Invalid clip group.';
            if (!lanes.has(c.trackId) || lanes.get(c.trackId).kind !== kind || !int(c.start, 0, 18000) || !int(c.len, 1, 18000) || c.start + c.len > 18000) return 'Clip timing or track is invalid.';
            if (kind === 'text') {
                if (c.caption !== undefined && typeof c.caption !== 'boolean') return 'Invalid caption flag.';
                if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 1000 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(c.text) || !number(c.x, 0, 1) || !number(c.y, 0, 1) || !int(c.size, 2, 40)) return 'Invalid text.';
                if (c.style !== undefined && (!exact(c.style, Object.keys(TEXT_DEFAULTS)) || !colour(c.style.color) || !colour(c.style.background) || !colour(c.style.stroke) || !number(c.style.backgroundOpacity, 0, 1) || !number(c.style.strokeWidth, 0, 12) || !['normal', 'bold'].includes(c.style.weight) || !['sans-serif', 'serif', 'monospace'].includes(c.style.font) || !['left', 'center', 'right'].includes(c.style.align))) return 'Invalid text style.';
            } else {
                const m = tl.media[c.mediaId], rate = c.rate ?? 1;
                if (!m || (kind === 'video' && m.kind === 'audio') || (kind === 'audio' && !m.hasAudio)) return 'A clip points at an incompatible file.';
                if (!number(c.in, 0, 1e7) || !number(rate, 0.1, 8) || (!['image', 'graphic'].includes(m.kind) && c.in + (c.len - 1) * rate >= m.frames) || !number(c.volume, 0, 2)) return 'A clip range or volume is invalid.';
                if (kind === 'video' && !int(c.transition, 0, 60)) return 'Invalid transition.';
                if (['fadeIn', 'fadeOut'].some(key => c[key] !== undefined && !int(c[key], 0, c.len))) return 'Invalid audio fade.';
                if (c.pan !== undefined && !number(c.pan, -1, 1)) return 'Invalid audio pan.';
                if (c.eq !== undefined && (!exact(c.eq, ['low', 'mid', 'high']) || Object.values(c.eq).some(n => !number(n, -24, 24)))) return 'Invalid audio EQ.';
            }
            const bad = visualProblem(c); if (bad) return bad;
        }
    }
    if (new TextEncoder().encode(JSON.stringify(tl)).byteLength > 30000) return 'This project is too large to save. Use fewer clips or caption lines.';
    return null;
}
