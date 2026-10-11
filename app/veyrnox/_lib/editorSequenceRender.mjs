import { smartPicture,smartPictureActive } from './editorSmartPicture.mjs';
import { captionPresentation,WORD_STYLE } from './editorWords.mjs';
import { TEXT_EXTRAS } from './editorTextStyle.mjs';
import { evaluatedTransform, evaluatedParameters } from './editorAnimation.mjs';
export { evaluatedTransform } from './editorAnimation.mjs';
import { paintBackground } from './editorBackground.mjs';
import { colourPicture, neutralColour } from './editorColour.mjs';
import { maskedPicture } from './editorMask.mjs';
import { trackFor, sourceFrame, sequenceTransition } from './editorSequence.mjs';
import { TEXT_DEFAULTS } from './editorSequenceValidation.mjs';
export function sequenceLayers(tl, frame) {
    const active = c => frame >= c.start && frame < c.start + c.len && !trackFor(tl, c)?.hidden;
    const order = (a, b) => tl.tracks.findIndex(t => t.id === a.clip.trackId) - tl.tracks.findIndex(t => t.id === b.clip.trackId);
    const visuals = tl.video.map((clip, k) => ({ clip, k, time: Math.max(0,Math.min(sourceFrame(clip, frame - clip.start), tl.media[clip.mediaId].frames - 1)) / 30, offset: frame - clip.start })).filter(v => active(v.clip)).sort(order);
    for (const visual of [...visuals]) {
        const duration = sequenceTransition(tl, visual.k);
        if (visual.offset < duration) {
            const previous = tl.video.find(c => c.trackId === visual.clip.trackId && c.start + c.len === visual.clip.start);
            const k = tl.video.indexOf(previous);
            const under = { clip: previous, k, time: Math.max(0,Math.min(sourceFrame(previous, previous.len + visual.offset), tl.media[previous.mediaId].frames - 1)) / 30, offset: previous.len - 1 };
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
export function paintSequence(g, W, H, layers, pictures) {
    g.save(); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.fillStyle = layers.background; g.fillRect(0, 0, W, H);
    layers.visuals.forEach((v, i) => {
        const pic = pictures.visuals[i]; if (!pic) return;
        const c = v.clip;
        const t = evaluatedTransform(c, v.offset), parameters=evaluatedParameters(c,v.offset),f=parameters.filter;
        paintBackground(g,W,H,c,pic,pictures.backgrounds?.[i],t.opacity*(v.alpha??1),v.wipe);
        const crop = c.crop || { x: 0, y: 0, width: 1, height: 1 };
        const sw = pic.width * crop.width, sh = pic.height * crop.height;
        const factor = (c.fit === 'cover' ? Math.max : Math.min)(W / sw, H / sh);
        const w = sw * factor, h = sh * factor;
        g.save(); g.translate(W * (t.x + (v.slide || 0)), H * t.y); g.rotate(t.rotation * Math.PI / 180); g.scale(t.scale * (v.zoom || 1) * (t.flipX ? -1 : 1), t.scale * (v.zoom || 1) * (t.flipY ? -1 : 1));
        g.globalAlpha = t.opacity * (v.alpha ?? 1); g.globalCompositeOperation = c.blend || 'source-over';
        g.filter = `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturate}) hue-rotate(${f.hue}deg) blur(${f.blur}px)`;
        if (v.wipe !== undefined) { g.beginPath(); g.rect(-w / 2, -h / 2, w * v.wipe, h); g.clip(); }
        const effect = c.effect;
        const processed=smartPictureActive(c.smartPicture)?smartPicture(pic,crop,c.smartPicture,w,h):pic;
        const processedCrop=processed===pic?crop:{x:0,y:0,width:1,height:1};
        const adjustedColour=!neutralColour(parameters.colour) ? colourPicture(processed,processedCrop,parameters.colour,w,h):processed;
        const colourCrop=adjustedColour===pic?crop:{x:0,y:0,width:1,height:1};
        if (c.mask && c.mask !== 'none') {
            const base = effect && effect.type !== 'none' && effect.intensity > 0 ? effectPicture(adjustedColour, colourCrop, effect, v.offset) : adjustedColour;
            const bounds = base === pic ? crop : { x: 0, y: 0, width: 1, height: 1 };
            g.drawImage(maskedPicture(base, bounds, c, v.offset, w, h), -w / 2, -h / 2, w, h);
        } else if (effect && effect.type !== 'none' && effect.intensity > 0) {
            const adjusted = effectPicture(adjustedColour, colourCrop, effect, v.offset);
            g.drawImage(adjusted, -w / 2, -h / 2, w, h);
        } else g.drawImage(adjustedColour, adjustedColour.width * colourCrop.x, adjustedColour.height * colourCrop.y, adjustedColour.width * colourCrop.width, adjustedColour.height * colourCrop.height, -w / 2, -h / 2, w, h);
        g.restore();
    });
    for (const item of layers.texts) paintStyledText(g, W, H, item);
    g.restore();
}
export function paintStyledText(g, W, H, item) {
    const s = { ...TEXT_DEFAULTS,...TEXT_EXTRAS, ...item.style }, t = evaluatedTransform(item, item.offset || 0);
    const presentation=captionPresentation(item,item.offset||0),px = Math.max(8, H * item.size / 100), lines = presentation.text.split('\n');
    g.save(); g.translate(W * item.x + (t.x - 0.5) * W, H * item.y + (t.y - 0.5) * H); g.scale(t.scale, t.scale); g.rotate(t.rotation * Math.PI / 180); g.globalAlpha = t.opacity;
    g.font = `${s.italic?'italic ':''}${s.weight} ${px}px "${s.font}", ${s.font==='serif' || ['Georgia','Times New Roman'].includes(s.font)?'serif':s.font==='monospace' || s.font==='Courier New'?'monospace':'sans-serif'}`; g.letterSpacing=`${s.letterSpacing*H/720}px`; g.textAlign = s.align; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const h = px * s.lineHeight, y0 = -(lines.length - 1) * h / 2;
    let lineOffset=0;
    for (const [i, line] of lines.entries()) {
        const width = Math.min(g.measureText(line).width, W * 0.92), y = y0 + i * h;
        if (s.backgroundOpacity) { g.globalAlpha = t.opacity * s.backgroundOpacity; g.fillStyle = s.background; g.fillRect(s.align === 'center' ? -width / 2 - 8 : s.align === 'right' ? -width - 8 : -8, y - h / 2, width + 16, h); g.globalAlpha = t.opacity; }
        const rgb=s.shadowColor.slice(1).match(/../g).map(v=>parseInt(v,16));g.shadowColor=`rgba(${rgb.join(',')},${s.shadowOpacity})`;g.shadowBlur=s.shadowBlur*H/720;g.shadowOffsetX=s.shadowX*H/720;g.shadowOffsetY=s.shadowY*H/720;
        g.strokeStyle = s.stroke; g.lineWidth = s.strokeWidth; g.fillStyle = s.color;
        if (s.strokeWidth) g.strokeText(line, 0, y, W * 0.92); g.fillText(line, 0, y, W * 0.92);
        if(s.underline){g.fillRect(s.align==='center'?-width/2:s.align==='right'?-width:0,y+px*.4,width,Math.max(1,px/20));}
        g.shadowColor='transparent';
        const ratio=width/Math.max(1,g.measureText(line).width),left=s.align==='center'?-width/2:s.align==='right'?-width:0;
        for(const range of presentation.ranges){const from=Math.max(0,range.from-lineOffset),to=Math.min(line.length,range.to-lineOffset);if(to<=from)continue;const x=left+g.measureText(line.slice(0,from)).width*ratio,end=left+g.measureText(line.slice(0,to)).width*ratio;g.save();g.beginPath();g.rect(x,y-h/2,end-x,h);g.clip();g.fillStyle=item.wordStyle?.color || WORD_STYLE.color;g.fillText(line,0,y,W*.92);if(s.underline)g.fillRect(left,y+px*.4,width,Math.max(1,px/20));g.restore();}
        lineOffset+=line.length+1;
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
