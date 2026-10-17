import { smartPicture,smartPictureActive } from './editorSmartPicture.mjs';
import { captionPresentation,WORD_STYLE } from './editorWords.mjs';
import { TEXT_EXTRAS } from './editorTextStyle.mjs';
import { evaluatedTransform, evaluatedParameters, evaluatedReveal } from './editorAnimation.mjs';
export { evaluatedTransform } from './editorAnimation.mjs';
import { paintBackground } from './editorBackground.mjs';
import { colourPicture, neutralColour } from './editorColour.mjs';
import { maskedPicture } from './editorMask.mjs';
import { trackFor, sourceFrame, sequenceTransition } from './editorSequence.mjs';
import { TEXT_DEFAULTS } from './editorSequenceValidation.mjs';
import { transitionParams, clipPictureShape, paintLightLeak } from './editorTransitionGeometry.mjs';
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
            const wipe=type.startsWith('wipe-'),slide=type==='slide'||type.startsWith('slide-');
            visual.alpha = type === 'dip-black' ? Math.max(0, p * 2 - 1) : wipe || slide ? 1 : p;
            if (type === 'dip-black') under.alpha = Math.max(0, 1 - p * 2);
            if (wipe) visual.wipe = {direction:type.slice(5),progress:p};
            if (slide) {
                const direction=type==='slide'?'left':type.slice(6),amount=1-p;
                visual.slideX=direction==='left'?amount:direction==='right'?-amount:0;
                visual.slideY=direction==='up'?amount:direction==='down'?-amount:0;
            }
            if (type === 'zoom') visual.zoom = 0.8 + p * 0.2;
            if (type === 'blur') visual.transitionBlur = (1-p)*18;
            if (type === 'flash') visual.flash = Math.sin(p*Math.PI);
            const extra = transitionParams(type, p, visual.offset);
            if (extra) { Object.assign(visual, extra.incoming); Object.assign(under, extra.outgoing); }
            visuals.splice(visuals.indexOf(visual), 0, under);
        }
    }
    return { visuals, texts: tl.text.filter(active).sort((a, b) => tl.tracks.findIndex(t => t.id === a.trackId) - tl.tracks.findIndex(t => t.id === b.trackId)).map(c => ({ ...c, offset: frame - c.start })), background: tl.background };
}
const revealActive=reveal=>reveal.x!==0||reveal.y!==0||reveal.width!==1||reveal.height!==1;
function clipReveal(g,reveal,x,y,width,height) {
    if(!revealActive(reveal))return;
    g.beginPath();g.rect(x+width*reveal.x,y+height*reveal.y,width*reveal.width,height*reveal.height);g.clip();
}
/** Include styled line boxes, stroke and shadow so a wipe clips the entire title together. */
function titleRevealBounds(g,lines,px,lineHeight,y0,style,H,W) {
    const padding=Math.max(style.backgroundOpacity?8:0,style.strokeWidth/2+(style.shadowOpacity?style.shadowBlur*H/720*3:0));
    const shadowX=style.shadowOpacity?style.shadowX*H/720:0,shadowY=style.shadowOpacity?style.shadowY*H/720:0;
    let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
    for(const [index,line] of lines.entries()) {
        const metrics=g.measureText(line),width=Math.min(metrics.width,W*.92);
        // Match fillText's maximum width and alignment, not a font-dependent character count.
        const y=y0+index*lineHeight,x=style.align==='center'?-width/2:style.align==='right'?-width:0;
        const ratio=width/Math.max(1,metrics.width);
        const inkLeft=Number.isFinite(metrics.actualBoundingBoxLeft)?-metrics.actualBoundingBoxLeft*ratio:x;
        const inkRight=Number.isFinite(metrics.actualBoundingBoxRight)?metrics.actualBoundingBoxRight*ratio:x+width;
        left=Math.min(left,x,inkLeft);right=Math.max(right,x+width,inkRight);
        top=Math.min(top,y-Math.max(lineHeight/2,metrics.actualBoundingBoxAscent||px*.75));
        bottom=Math.max(bottom,y+Math.max(lineHeight/2,metrics.actualBoundingBoxDescent||px*.25));
    }
    left+=Math.min(0,shadowX)-padding;right+=Math.max(0,shadowX)+padding;
    top+=Math.min(0,shadowY)-padding;bottom+=Math.max(0,shadowY)+padding;
    return {x:left,y:top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
}
export function paintSequence(g, W, H, layers, pictures) {
    g.save(); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.fillStyle = layers.background; g.fillRect(0, 0, W, H);
    layers.visuals.forEach((v, i) => {
        const pic = pictures.visuals[i]; if (!pic) return;
        const c = v.clip;
        const t = evaluatedTransform(c, v.offset), reveal=evaluatedReveal(c,v.offset), parameters=evaluatedParameters(c,v.offset),f=parameters.filter;
        if(revealActive(reveal)){g.save();clipReveal(g,reveal,0,0,W,H);}
        if(v.shape!==undefined){g.save();clipPictureShape(g,0,0,W,H,v.shape);}
        paintBackground(g,W,H,c,pic,pictures.backgrounds?.[i],t.opacity*(v.alpha??1),v.wipe);
        if(v.shape!==undefined)g.restore();
        if(revealActive(reveal))g.restore();
        const crop = c.crop || { x: 0, y: 0, width: 1, height: 1 };
        const sw = pic.width * crop.width, sh = pic.height * crop.height;
        const factor = (c.fit === 'cover' ? Math.max : Math.min)(W / sw, H / sh);
        const w = sw * factor, h = sh * factor;
        g.save(); g.translate(W * (t.x + (v.slideX || 0)), H * (t.y + (v.slideY || 0))); g.rotate((t.rotation + (v.spin || 0)) * Math.PI / 180); g.scale(t.scale * (v.zoom || 1) * (t.flipX ? -1 : 1), t.scale * (v.zoom || 1) * (t.flipY ? -1 : 1));
        g.globalAlpha = t.opacity * (v.alpha ?? 1); g.globalCompositeOperation = c.blend || 'source-over';
        g.filter = `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturate}) hue-rotate(${f.hue}deg) blur(${f.blur+(v.transitionBlur||0)}px)`;
        if (v.wipe !== undefined) clipPictureWipe(g,-w/2,-h/2,w,h,v.wipe);
        if (v.shape !== undefined) clipPictureShape(g,-w/2,-h/2,w,h,v.shape);
        clipReveal(g,reveal,-w/2,-h/2,w,h);
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
        if(v.flash){g.save();g.globalCompositeOperation='screen';g.globalAlpha=v.flash*.75;g.fillStyle='#ffffff';g.fillRect(0,0,W,H);g.restore();}
        if(v.leak){paintLightLeak(g,W,H,v.leak);}
    });
    for (const item of layers.texts) paintStyledText(g, W, H, item);
    g.restore();
}
export function paintStyledText(g, W, H, item) {
    const s = { ...TEXT_DEFAULTS,...TEXT_EXTRAS, ...item.style }, t = evaluatedTransform(item, item.offset || 0);
    const reveal=evaluatedReveal(item,item.offset||0),presentation=captionPresentation(item,item.offset||0),px = Math.max(8, H * item.size / 100), lines = presentation.text.split('\n');
    g.save(); g.translate(W * item.x + (t.x - 0.5) * W, H * item.y + (t.y - 0.5) * H); g.scale(t.scale, t.scale); g.rotate(t.rotation * Math.PI / 180); g.globalAlpha = t.opacity;
    g.font = `${s.italic?'italic ':''}${s.weight} ${px}px "${s.font}", ${s.font==='serif' || ['Georgia','Times New Roman'].includes(s.font)?'serif':s.font==='monospace' || s.font==='Courier New'?'monospace':'sans-serif'}`; g.letterSpacing=`${s.letterSpacing*H/720}px`; g.textAlign = s.align; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const h = px * s.lineHeight, y0 = -(lines.length - 1) * h / 2;
    if(revealActive(reveal)){const bounds=titleRevealBounds(g,lines,px,h,y0,s,H,W);clipReveal(g,reveal,bounds.x,bounds.y,bounds.width,bounds.height);}
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

function clipPictureWipe(g,x,y,w,h,wipe){
    const progress=typeof wipe==='number'?wipe:wipe.progress,direction=typeof wipe==='number'?'left':wipe.direction;
    const bounds=direction==='right'?[x+w*(1-progress),y,w*progress,h]:direction==='up'?[x,y+h*(1-progress),w,h*progress]:direction==='down'?[x,y,w,h*progress]:[x,y,w*progress,h];
    g.beginPath();g.rect(...bounds);g.clip();
}

/** Effects are composed against the source alpha, so transparent elements keep transparent edges. */
function effectPicture(pic, crop, effect, offset) {
    const w = Math.max(1, Math.ceil(pic.width * crop.width)), h = Math.max(1, Math.ceil(pic.height * crop.height));
    if(effect.type==='posterize'){
        // Quantisation reads pixels back to the CPU. Bound that surface for 2K/4K
        // exports, then let the compositor scale the intentionally banded result.
        const scale=Math.min(1,640/w,360/h),pw=Math.max(1,Math.round(w*scale)),ph=Math.max(1,Math.round(h*scale));
        const posterized=new OffscreenCanvas(pw,ph),context=posterized.getContext('2d');
        context.drawImage(pic,pic.width*crop.x,pic.height*crop.y,pic.width*crop.width,pic.height*crop.height,0,0,pw,ph);
        const image=context.getImageData(0,0,pw,ph),levels=Math.max(2,Math.round(8-effect.intensity*5)),step=255/(levels-1);
        for(let i=0;i<image.data.length;i+=4)for(let channel=0;channel<3;channel++)image.data[i+channel]=Math.round(image.data[i+channel]/step)*step;
        context.putImageData(image,0,0);return posterized;
    }
    const out = new OffscreenCanvas(w, h), g = out.getContext('2d');
    const source=[pic,pic.width*crop.x,pic.height*crop.y,pic.width*crop.width,pic.height*crop.height,0,0,w,h];
    if (effect.type === 'pixelate') {
        const small = new OffscreenCanvas(Math.max(4, Math.round(w * (1 - effect.intensity * .98))), Math.max(4, Math.round(h * (1 - effect.intensity * .98))));
        small.getContext('2d').drawImage(pic, pic.width * crop.x, pic.height * crop.y, pic.width * crop.width, pic.height * crop.height, 0, 0, small.width, small.height);
        g.imageSmoothingEnabled = false; g.drawImage(small, 0, 0, w, h);
    } else if(effect.type==='mirror'){
        g.save();g.beginPath();g.rect(0,0,w/2,h);g.clip();g.drawImage(...source);g.restore();
        g.save();g.beginPath();g.rect(w/2,0,w/2,h);g.clip();g.translate(w,0);g.scale(-1,1);g.drawImage(...source);g.restore();
    } else if(effect.type==='tiles'){
        const columns=effect.intensity>.65?4:effect.intensity>.3?3:2,rows=columns,tw=w/columns,th=h/rows,drift=Math.sin(offset*.12)*tw*.15*effect.intensity;
        for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){g.save();g.beginPath();g.rect(x*tw,y*th,tw,th);g.clip();g.drawImage(pic,pic.width*crop.x,pic.height*crop.y,pic.width*crop.width,pic.height*crop.height,x*tw+drift*(y%2?1:-1),y*th,tw,th);g.restore();}
    } else {
        if(effect.type==='mono')g.filter=`grayscale(${effect.intensity})`;
        if(effect.type==='sepia')g.filter=`sepia(${effect.intensity})`;
        if(effect.type==='old-film')g.filter=`sepia(${.25+.65*effect.intensity}) contrast(${1+.18*effect.intensity}) brightness(${.95+Math.sin(offset*.7)*.04*effect.intensity})`;
        if(effect.type==='pulse')g.filter=`brightness(${1+(.5+.5*Math.sin(offset*.18))*effect.intensity*.75})`;
        if(effect.type==='soft-glow'){g.filter=`blur(${2+effect.intensity*10}px) brightness(${1+effect.intensity*.4})`;g.globalAlpha=.45+effect.intensity*.3;}
        g.drawImage(...source);g.filter='none';g.globalAlpha=1;
        if(effect.type==='soft-glow'){g.globalCompositeOperation='screen';g.globalAlpha=.75;g.drawImage(...source);g.globalAlpha=1;}
        if(effect.type==='chromatic'){
            const shift=Math.max(1,Math.round(effect.intensity*w*.025));g.globalCompositeOperation='screen';g.globalAlpha=.38*effect.intensity;g.drawImage(pic,pic.width*crop.x,pic.height*crop.y,pic.width*crop.width,pic.height*crop.height,-shift,0,w,h);g.drawImage(pic,pic.width*crop.x,pic.height*crop.y,pic.width*crop.width,pic.height*crop.height,shift,0,w,h);g.globalAlpha=1;
        }
        g.globalCompositeOperation = 'source-atop';
        if (effect.type === 'vignette') { const gradient = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .2, w / 2, h / 2, Math.max(w, h) * .6); gradient.addColorStop(0, '#00000000'); gradient.addColorStop(1, `rgba(0,0,0,${effect.intensity})`); g.fillStyle = gradient; g.fillRect(0, 0, w, h); }
        if (effect.type === 'grain') { g.fillStyle = `rgba(255,255,255,${effect.intensity * .5})`; for (let n = 0; n < 150; n++) { const seed = (n * 137 + offset * 23) % 997; g.fillRect(seed / 997 * w, ((seed * 53) % 991) / 991 * h, 2, 2); } }
        if(effect.type==='negative'){g.globalCompositeOperation='difference';g.globalAlpha=effect.intensity;g.fillStyle='#ffffff';g.fillRect(0,0,w,h);g.globalAlpha=1;}
        if(effect.type==='scanlines'||effect.type==='old-film'){g.fillStyle=`rgba(0,0,0,${.08+.22*effect.intensity})`;const step=Math.max(3,Math.round(8-effect.intensity*5));for(let y=offset%step;y<h;y+=step)g.fillRect(0,y,w,1);}
        if(effect.type==='old-film'){g.fillStyle=`rgba(255,246,214,${.12*effect.intensity})`;g.fillRect(0,0,w,h);g.fillStyle=`rgba(255,255,255,${.35*effect.intensity})`;for(let n=0;n<5;n++){const x=((n*211+offset*17)%997)/997*w;g.fillRect(x,0,Math.max(1,effect.intensity*2),h);}}
        if(effect.type==='light-leak'){const x=((offset*7)%(w*2))-w/2,gradient=g.createRadialGradient(x,h*.45,0,x,h*.45,Math.max(w,h)*.7);gradient.addColorStop(0,`rgba(255,244,180,${.75*effect.intensity})`);gradient.addColorStop(.45,`rgba(255,92,64,${.35*effect.intensity})`);gradient.addColorStop(1,'rgba(255,40,20,0)');g.globalCompositeOperation='screen';g.fillStyle=gradient;g.fillRect(0,0,w,h);}
        if(effect.type==='strobe'){const on=Math.sin(offset*.7)>0;g.globalCompositeOperation='screen';g.fillStyle=`rgba(255,255,255,${on?effect.intensity*.8:0})`;g.fillRect(0,0,w,h);}
        if(effect.type==='duotone'){g.globalCompositeOperation='multiply';g.fillStyle=`rgba(66,31,121,${effect.intensity})`;g.fillRect(0,0,w,h);g.globalCompositeOperation='screen';g.fillStyle=`rgba(50,214,197,${effect.intensity*.7})`;g.fillRect(0,0,w,h);}
    }
    return out;
}
