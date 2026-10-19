import { helperEnglish } from '../../../lib/helperMessages.mjs';
export const HSL_CHANNELS = Object.freeze(['red','orange','yellow','green','cyan','blue','purple','magenta']);
export const CURVE_CHANNELS = Object.freeze(['master','red','green','blue']);
const centres = [0,30,60,120,180,240,270,300];
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const range = (v,a,b) => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;
export function colourDefaults() { return { exposure:0, temperature:0, tint:0, shadows:0, highlights:0, gamma:1, hsl:Object.fromEntries(HSL_CHANNELS.map(k => [k,{hue:0,saturation:0,luminance:0}])), curves:Object.fromEntries(CURVE_CHANNELS.map(k => [k,[{x:0,y:0},{x:1,y:1}]])) }; }
export function colourProblem(c) {
    if (c === undefined) return null;
    if (!exact(c, ['exposure','temperature','tint','shadows','highlights','gamma','hsl','curves']) || !range(c.exposure,-3,3) || ['temperature','tint','shadows','highlights'].some(k => !range(c[k],-1,1)) || !range(c.gamma,.1,4)) return helperEnglish('invalid_advanced_colour_adjustment');
    if (!exact(c.hsl,HSL_CHANNELS) || Object.values(c.hsl).some(v => !exact(v,['hue','saturation','luminance']) || !range(v.hue,-180,180) || !range(v.saturation,-1,1) || !range(v.luminance,-1,1))) return helperEnglish('invalid_hsl_adjustment');
    if (!exact(c.curves,CURVE_CHANNELS) || Object.values(c.curves).some(points => !Array.isArray(points) || points.length < 2 || points.length > 8 || points[0].x !== 0 || points.at(-1).x !== 1 || points.some((p,i) => !exact(p,['x','y']) || !range(p.x,0,1) || !range(p.y,0,1) || (i && p.x <= points[i-1].x)))) return helperEnglish('invalid_colour_curve');
    return null;
}
export function curveValue(points, value) {
    const v=clamp(value), right=points.findIndex(p => p.x >= v);
    if (right <= 0) return points[0].y;
    const a=points[right-1],b=points[right]; return a.y+(b.y-a.y)*(v-a.x)/(b.x-a.x);
}
export function rgbHsl(r,g,b) {
    const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;
    if (!d) return [0,0,l];
    const h=max===r ? ((g-b)/d+(g<b?6:0))*60 : max===g ? ((b-r)/d+2)*60 : ((r-g)/d+4)*60;
    return [h,d/(1-Math.abs(2*l-1)),l];
}
export function hslRgb(h,s,l) {
    const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;
    const values=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x]; return values.map(v=>v+m);
}
/** Pixel operation shared by preview, cover and export; alpha is never altered. */
const colourTables = new WeakMap();
export function adjustColourPixels(data,c) {
    let tables=colourTables.get(c);
    if(!tables) { tables=['red','green','blue'].map(name=>Array.from({length:256},(_,i)=>Math.round(curveValue(c.curves[name],curveValue(c.curves.master,i/255))*255))); colourTables.set(c,tables); }
    const gain=2**c.exposure/255, balance=[1+c.temperature*.2+c.tint*.05,1-c.tint*.15,1-c.temperature*.2+c.tint*.05],gamma=1/c.gamma;
    const hslActive=Object.values(c.hsl).some(v=>v.hue || v.saturation || v.luminance);
    for(let i=0;i<data.length;i+=4) {
        let r=clamp(data[i]*gain*balance[0]),g=clamp(data[i+1]*gain*balance[1]),b=clamp(data[i+2]*gain*balance[2]);
        const luma=r*.2126+g*.7152+b*.0722,shift=c.shadows*(1-luma)**2*.35+c.highlights*luma**2*.35;
        r=clamp(r+shift);g=clamp(g+shift);b=clamp(b+shift);
        if(gamma!==1) { r**=gamma;g**=gamma;b**=gamma; }
        if(hslActive) {
            let [h,s,l]=rgbHsl(r,g,b),dh=0,ds=0,dl=0,weights=0;
            for(let k=0;k<centres.length;k++) { const delta=(h-centres[k]+540)%360-180,previous=centres[(k+centres.length-1)%centres.length],next=centres[(k+1)%centres.length],span=delta<0?(centres[k]-previous+360)%360:(next-centres[k]+360)%360,weight=Math.max(0,1-Math.abs(delta)/span); if(!weight)continue; const channel=c.hsl[HSL_CHANNELS[k]]; weights+=weight; dh+=channel.hue*weight;ds+=channel.saturation*weight;dl+=channel.luminance*weight; }
            if(weights) { h=(h+dh/weights*s+360)%360;s=clamp(s*(1+ds/weights));l=clamp(l+dl/weights*s*.5); }
            [r,g,b]=hslRgb(h,s,l);
        }
        data[i]=tables[0][Math.round(clamp(r)*255)];data[i+1]=tables[1][Math.round(clamp(g)*255)];data[i+2]=tables[2][Math.round(clamp(b)*255)];
    }
    return data;
}
export function neutralColour(c) { return c.exposure===0 && ['temperature','tint','shadows','highlights'].every(k=>c[k]===0) && c.gamma===1 && Object.values(c.hsl).every(v=>Object.values(v).every(n=>n===0)) && Object.values(c.curves).every(points=>points.every(p=>p.x===p.y)); }
export function colourPicture(pic,crop,adjustment,width,height) {
    const ratio=Math.min(1,4096/Math.max(width,height)),w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio));
    const canvas=new OffscreenCanvas(w,h),g=canvas.getContext('2d',{willReadFrequently:true});
    g.drawImage(pic,pic.width*crop.x,pic.height*crop.y,pic.width*crop.width,pic.height*crop.height,0,0,w,h);
    const pixels=g.getImageData(0,0,w,h);adjustColourPixels(pixels.data,adjustment);g.putImageData(pixels,0,0);return canvas;
}
