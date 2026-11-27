import { helperEnglish } from '../../../lib/helperMessages.mjs';
/** Per-clip backdrops share the preview/export compositor and retain normal track ordering. */
export const BACKGROUND_DEFAULTS = Object.freeze({ type: 'none', color: '#000000', blur: 18, mediaId: '' });
export function backgroundProblem(value, media) {
    if (value === undefined) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return helperEnglish('invalid_clip_background');
    const keys=Object.keys(value),baseKeys=Object.keys(BACKGROUND_DEFAULTS),gradientKeys=['secondaryColor','angle'];
    if (baseKeys.some(k => !Object.hasOwn(value,k)) || keys.some(k => !baseKeys.includes(k) && !gradientKeys.includes(k)) ||
        !['none','solid','blur','image','gradient','video'].includes(value.type) || !/^#[0-9a-fA-F]{6}$/.test(value.color) ||
        !Number.isFinite(value.blur) || value.blur < 0 || value.blur > 60 || typeof value.mediaId !== 'string') return helperEnglish('invalid_clip_background');
    if(value.type==='gradient') {
        if(keys.length!==6 || !/^#[0-9a-fA-F]{6}$/.test(value.secondaryColor) || !Number.isFinite(value.angle) || value.angle<0 || value.angle>360 || value.mediaId!=='') return helperEnglish('invalid_clip_background');
    } else if(keys.length!==4) return helperEnglish('invalid_clip_background');
    if (value.type === 'image' ? !['image','graphic'].includes(media?.[value.mediaId]?.kind)
        : value.type === 'video' ? media?.[value.mediaId]?.kind !== 'video'
        : value.mediaId !== '') return helperEnglish('choose_a_project_image_for_the_background');
    return null;
}
export const backgroundMediaIds = clip => [
    ...(['image','video'].includes(clip.background?.type) ? [clip.background.mediaId] : []),
    ...(clip.semanticMask?.mediaId ? [clip.semanticMask.mediaId] : []),
];
function clipWipe(g,x,y,w,h,wipe) {
    const progress=typeof wipe==='number'?wipe:wipe.progress,direction=typeof wipe==='number'?'left':wipe.direction;
    const bounds=direction==='right'?[x+w*(1-progress),y,w*progress,h]:direction==='up'?[x,y+h*(1-progress),w,h*progress]:direction==='down'?[x,y,w,h*progress]:[x,y,w*progress,h];
    g.beginPath();g.rect(...bounds);g.clip();
}
export function paintBackground(g,W,H,clip,picture,image,alpha=1,wipe) {
    const b=clip.background;
    if (!b || b.type === 'none') return;
    g.save();g.globalCompositeOperation='source-over';g.globalAlpha=alpha;g.filter='none';
    if(wipe!==undefined)clipWipe(g,0,0,W,H,wipe);
    if(b.type==='gradient') {
        const radians=(b.angle??135)*Math.PI/180,dx=Math.cos(radians),dy=Math.sin(radians),cx=W/2,cy=H/2,length=Math.abs(dx)*W/2+Math.abs(dy)*H/2;
        const gradient=g.createLinearGradient(cx-dx*length,cy-dy*length,cx+dx*length,cy+dy*length);
        gradient.addColorStop(0,b.color);gradient.addColorStop(1,b.secondaryColor);g.fillStyle=gradient;
    } else g.fillStyle=b.color;
    g.fillRect(0,0,W,H);
    const source=b.type==='blur'?picture:['image','video'].includes(b.type)?image:null;
    if(source) {
        const crop=b.type==='blur'?(clip.crop || {x:0,y:0,width:1,height:1}):{x:0,y:0,width:1,height:1};
        const sw=source.width*crop.width,sh=source.height*crop.height;
        // Overscan the blurred picture to avoid dark filter edges. Radius scales with output height.
        const pad=b.type==='blur'?b.blur*H/720*3:0,scale=Math.max((W+pad*2)/sw,(H+pad*2)/sh),w=sw*scale,h=sh*scale;
        if(b.type==='blur')g.filter=`blur(${b.blur*H/720}px)`;
        g.drawImage(source,source.width*crop.x,source.height*crop.y,sw,sh,(W-w)/2,(H-h)/2,w,h);
    }
    g.restore();
}
