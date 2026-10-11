/** Per-clip backdrops share the preview/export compositor and retain normal track ordering. */
export const BACKGROUND_DEFAULTS = Object.freeze({ type: 'none', color: '#000000', blur: 18, mediaId: '' });
export function backgroundProblem(value, media) {
    if (value === undefined) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4 || Object.keys(value).some(k => !Object.hasOwn(BACKGROUND_DEFAULTS,k)) || !['none','solid','blur','image'].includes(value.type) || !/^#[0-9a-fA-F]{6}$/.test(value.color) || !Number.isFinite(value.blur) || value.blur < 0 || value.blur > 60 || typeof value.mediaId !== 'string') return 'Invalid clip background.';
    if (value.type === 'image' ? !['image','graphic'].includes(media?.[value.mediaId]?.kind) : value.mediaId !== '') return 'Choose a project image for the background.';
    return null;
}
export const backgroundMediaIds = clip => clip.background?.type === 'image' ? [clip.background.mediaId] : [];
export function paintBackground(g,W,H,clip,picture,image,alpha=1,wipe) {
    const b=clip.background;
    if (!b || b.type === 'none') return;
    g.save();g.globalCompositeOperation='source-over';g.globalAlpha=alpha;g.filter='none';
    if(wipe!==undefined){g.beginPath();g.rect(0,0,W*wipe,H);g.clip();}
    g.fillStyle=b.color;g.fillRect(0,0,W,H);
    const source=b.type==='blur'?picture:b.type==='image'?image:null;
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
