import { trackFor, sourceFrame, sequenceTransition } from './editorSequence.mjs';
import { TRANSFORM_DEFAULTS, FILTER_DEFAULTS, TEXT_DEFAULTS } from './editorSequenceValidation.mjs';
export function sequenceLayers(tl, frame) {
    const active = c => frame >= c.start && frame < c.start + c.len && !trackFor(tl, c)?.hidden;
    const order = (a, b) => tl.tracks.findIndex(t => t.id === a.clip.trackId) - tl.tracks.findIndex(t => t.id === b.clip.trackId);
    const visuals = tl.video.map((clip, k) => ({ clip, k, time: Math.min(sourceFrame(clip, frame - clip.start), tl.media[clip.mediaId].frames - 1) / 30, offset: frame - clip.start })).filter(v => active(v.clip)).sort(order);
    for (const visual of [...visuals]) {
        const duration = sequenceTransition(tl, visual.k);
        if (visual.offset < duration) {
            const previous = tl.video.find(c => c.trackId === visual.clip.trackId && c.start + c.len === visual.clip.start);
            const k = tl.video.indexOf(previous);
            const under = { clip: previous, k, time: Math.min(sourceFrame(previous, previous.len + visual.offset), tl.media[previous.mediaId].frames - 1) / 30, offset: previous.len - 1 };
            const p = (visual.offset + 1) / duration, type = visual.clip.transitionType || 'dissolve';
            visual.alpha = type === 'dip-black' ? Math.max(0, p * 2 - 1) : type === 'wipe-left' || type === 'slide' ? 1 : p;
            if (type === 'dip-black') under.alpha = Math.max(0, 1 - p * 2);
            if (type === 'wipe-left') visual.wipe = p;
            if (type === 'slide') visual.slide = 1 - p;
            if (type === 'zoom') visual.zoom = 0.8 + p * 0.2;
            visuals.splice(visuals.indexOf(visual), 0, under);
        }
    }
    return { visuals, texts: tl.text.filter(active).sort((a, b) => tl.tracks.findIndex(t => t.id === a.trackId) - tl.tracks.findIndex(t => t.id === b.trackId)).map(c => ({ ...c, offset: frame - c.start })), background: tl.background };
}
const ease = (v, mode) => mode === 'ease-in' ? v * v : mode === 'ease-out' ? 1 - (1 - v) ** 2 : mode === 'ease-in-out' ? v * v * (3 - 2 * v) : v;
export function evaluatedTransform(clip, offset, animate = true) {
    const t = { ...TRANSFORM_DEFAULTS, ...clip.transform };
    const keys = clip.keyframes || [];
    if (keys.length) {
        const left = [...keys].reverse().find(k => k.frame <= offset) || keys[0];
        const right = keys.find(k => k.frame >= offset) || keys.at(-1);
        const p = right.frame === left.frame ? 0 : ease((offset - left.frame) / (right.frame - left.frame), right.easing);
        for (const key of ['x', 'y', 'scale', 'rotation', 'opacity']) t[key] = left[key] + (right[key] - left[key]) * p;
    }
    const animation = clip.animation;
    if (animation && animate) {
        for (const [name, progress, exiting] of [[animation.in, Math.min(1, offset / animation.duration), false], [animation.out, Math.min(1, (clip.len - 1 - offset) / animation.duration), true]]) {
            const p = Math.max(0, progress);
            if (name === 'fade') t.opacity *= p;
            if (name === 'slide-left') t.x += (exiting ? 1 : -1) * (1 - p);
            if (name === 'slide-up') t.y -= 1 - p;
            if (name === 'zoom') { t.scale *= 0.5 + p * 0.5; t.opacity *= p; }
        }
    }
    return t;
}
export function paintSequence(g, W, H, layers, pictures) {
    g.save(); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.fillStyle = layers.background; g.fillRect(0, 0, W, H);
    layers.visuals.forEach((v, i) => {
        const pic = pictures.visuals[i]; if (!pic) return;
        const c = v.clip, t = evaluatedTransform(c, v.offset), f = { ...FILTER_DEFAULTS, ...c.filter };
        const crop = c.crop || { x: 0, y: 0, width: 1, height: 1 };
        const sw = pic.width * crop.width, sh = pic.height * crop.height;
        const factor = (c.fit === 'cover' ? Math.max : Math.min)(W / sw, H / sh);
        const w = sw * factor, h = sh * factor;
        g.save(); g.translate(W * (t.x + (v.slide || 0)), H * t.y); g.rotate(t.rotation * Math.PI / 180); g.scale(t.scale * (v.zoom || 1) * (t.flipX ? -1 : 1), t.scale * (v.zoom || 1) * (t.flipY ? -1 : 1));
        g.globalAlpha = t.opacity * (v.alpha ?? 1); g.globalCompositeOperation = c.blend || 'source-over';
        g.filter = `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturate}) hue-rotate(${f.hue}deg) blur(${f.blur}px)`;
        if (c.mask && c.mask !== 'none') {
            g.beginPath();
            if (c.mask === 'circle') g.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
            else if (c.mask === 'rounded') g.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.15);
            else g.rect(-w / 2, -h / 2, c.mask === 'vertical' ? w / 2 : w, c.mask === 'horizontal' ? h / 2 : h);
            g.clip();
        }
        if (v.wipe !== undefined) { g.beginPath(); g.rect(-w / 2, -h / 2, w * v.wipe, h); g.clip(); }
        const effect = c.effect;
        if (effect && effect.type !== 'none' && effect.intensity > 0) {
            const adjusted = effectPicture(pic, crop, effect, v.offset);
            g.drawImage(adjusted, -w / 2, -h / 2, w, h);
        } else g.drawImage(pic, pic.width * crop.x, pic.height * crop.y, sw, sh, -w / 2, -h / 2, w, h);
        g.restore();
    });
    for (const item of layers.texts) paintStyledText(g, W, H, item);
    g.restore();
}
export function paintStyledText(g, W, H, item) {
    const s = { ...TEXT_DEFAULTS, ...item.style }, t = evaluatedTransform(item, item.offset || 0);
    const px = Math.max(8, H * item.size / 100), lines = item.text.split('\n');
    g.save(); g.translate(W * item.x + (t.x - 0.5) * W, H * item.y + (t.y - 0.5) * H); g.scale(t.scale, t.scale); g.rotate(t.rotation * Math.PI / 180); g.globalAlpha = t.opacity;
    g.font = `${s.weight} ${px}px ${s.font}`; g.textAlign = s.align; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const h = px * 1.2, y0 = -(lines.length - 1) * h / 2;
    for (const [i, line] of lines.entries()) {
        const width = Math.min(g.measureText(line).width, W * 0.92), y = y0 + i * h;
        if (s.backgroundOpacity) { g.globalAlpha = t.opacity * s.backgroundOpacity; g.fillStyle = s.background; g.fillRect(s.align === 'center' ? -width / 2 - 8 : s.align === 'right' ? -width - 8 : -8, y - h / 2, width + 16, h); g.globalAlpha = t.opacity; }
        g.strokeStyle = s.stroke; g.lineWidth = s.strokeWidth; g.fillStyle = s.color;
        if (s.strokeWidth) g.strokeText(line, 0, y, W * 0.92); g.fillText(line, 0, y, W * 0.92);
    }
    g.restore();
}

/** Effects are composed against the source alpha, so transparent elements keep transparent edges. */
function effectPicture(pic, crop, effect, offset) {
    const w = Math.max(1, Math.ceil(pic.width * crop.width)), h = Math.max(1, Math.ceil(pic.height * crop.height));
    const out = new OffscreenCanvas(w, h), g = out.getContext('2d');
    if (effect.type === 'pixelate') {
        const small = new OffscreenCanvas(Math.max(4, Math.round(w * (1 - effect.intensity * .98))), Math.max(4, Math.round(h * (1 - effect.intensity * .98))));
        small.getContext('2d').drawImage(pic, pic.width * crop.x, pic.height * crop.y, pic.width * crop.width, pic.height * crop.height, 0, 0, small.width, small.height);
        g.imageSmoothingEnabled = false; g.drawImage(small, 0, 0, w, h);
    } else {
        g.drawImage(pic, pic.width * crop.x, pic.height * crop.y, pic.width * crop.width, pic.height * crop.height, 0, 0, w, h);
        g.globalCompositeOperation = 'source-atop';
        if (effect.type === 'vignette') { const gradient = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .2, w / 2, h / 2, Math.max(w, h) * .6); gradient.addColorStop(0, '#00000000'); gradient.addColorStop(1, `rgba(0,0,0,${effect.intensity})`); g.fillStyle = gradient; g.fillRect(0, 0, w, h); }
        if (effect.type === 'grain') { g.fillStyle = `rgba(255,255,255,${effect.intensity * .5})`; for (let n = 0; n < 150; n++) { const seed = (n * 137 + offset * 23) % 997; g.fillRect(seed / 997 * w, ((seed * 53) % 991) / 991 * h, 2, 2); } }
    }
    return out;
}
