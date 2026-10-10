// Browser timeline editor, slice 2 (ADR-0080): the one place that decides what a frame looks like. The preview and the export both
// call frameLayers() then paintFrame(), so they agree frame for frame; only where the pictures come from differs (a seekable sink
// in the preview, sequential readers in the export). Text is drawn with the canvas text API and never put into the page.
import { FPS, videoLayout, effectiveTransition, textsAt } from './editorTimeline.mjs';

export const EXPORT_HEIGHTS = Object.freeze([720, 1080]);
const ASPECT_RATIO = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 };

/** Even pixel sizes at the chosen shape (or the first clip's), with the long edge no wider than 1920. */
export function outputSize(width, height, targetHeight = 720, aspect = 'source') {
    const ratio = ASPECT_RATIO[aspect] ?? (width > 0 && height > 0 ? width / height : 16 / 9);
    let h = EXPORT_HEIGHTS.includes(targetHeight) ? targetHeight : 720;
    let w = h * ratio;
    if (w > 1920) { w = 1920; h = w / ratio; }
    const even = n => Math.max(2, Math.round(n / 2) * 2);
    return { width: even(w), height: even(h) };
}

export function timelineSize(tl, targetHeight = 720) {
    const first = tl.video.length ? tl.media[tl.video[0].mediaId] : null;
    return outputSize(first?.width, first?.height, targetHeight, tl.aspect);
}

/**
 * What to draw on timeline frame `i`. Pure. `base` and `over` name a video clip index and a SOURCE time in seconds, clamped to the
 * file's last frame (a clip under a dissolve keeps playing past its out point when the file has more, else holds its last frame).
 * `over.alpha` ramps from just above 0 to 1 across the dissolve, so the frame after the dissolve is the clip alone.
 */
export function frameLayers(tl, i) {
    const layout = videoLayout(tl);
    const k = layout.findIndex(item => i >= item.start && i < item.end);
    const texts = textsAt(tl, i);
    if (k < 0) return { base: null, over: null, texts };
    const { clip, start } = layout[k];
    const srcTime = (c, f) => Math.min(c.in + f, tl.media[c.mediaId].frames - 1) / FPS;
    const into = i - start;
    const tr = effectiveTransition(tl, k);
    if (tr > 0 && into < tr) {
        const prev = layout[k - 1].clip;
        return { base: { k: k - 1, time: srcTime(prev, prev.len + into) }, over: { k, time: srcTime(clip, into), alpha: (into + 1) / tr }, texts };
    }
    return { base: { k, time: srcTime(clip, into) }, over: null, texts };
}

/** Fetch the drawables a frame needs. `picture(k, time)` resolves to a drawable for video clip k at that source time, or null. */
export async function resolvePictures(layers, picture) {
    return {
        base: layers.base ? await picture(layers.base.k, layers.base.time) : null,
        over: layers.over ? await picture(layers.over.k, layers.over.time) : null,
    };
}

const fit = (g, pic, W, H) => {
    const s = Math.min(W / pic.width, H / pic.height);
    g.drawImage(pic, (W - pic.width * s) / 2, (H - pic.height * s) / 2, pic.width * s, pic.height * s);
};

/** Paint one frame onto a 2D context of size W x H from the layers and their resolved pictures. Synchronous. */
export function paintFrame(g, W, H, layers, pics) {
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    if (pics.base) fit(g, pics.base, W, H);
    if (layers.over && pics.over) {
        g.globalAlpha = Math.max(0, Math.min(1, layers.over.alpha));
        fit(g, pics.over, W, H);
        g.globalAlpha = 1;
    }
    for (const x of layers.texts) drawText(g, W, H, x);
}

/** One line of white text with a dark edge; `size` is a percentage of the picture height; bundled system fonts only. */
export function drawText(g, W, H, x) {
    const px = Math.max(8, Math.round(H * x.size / 100));
    g.font = `bold ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(2, px / 10);
    g.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    g.fillStyle = '#fff';
    const maxWidth = W * 0.92;
    g.strokeText(x.text, W * x.x, H * x.y, maxWidth);
    g.fillText(x.text, W * x.x, H * x.y, maxWidth);
}
