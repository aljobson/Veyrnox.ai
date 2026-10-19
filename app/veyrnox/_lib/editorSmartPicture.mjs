import { helperEnglish } from '../../../lib/helperMessages.mjs';
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
export const SMART_PICTURE=Object.freeze({denoise:0,keyEnabled:false,keyColor:'#00ff00',keyTolerance:.12,keyFeather:.1,despill:.5,light:0,lightX:.5,lightY:.5,lightRadius:.6});
export function smartPictureProblem(v) {
    if(v===undefined)return null;
    const bounds={denoise:[0,1],keyTolerance:[0,1],keyFeather:[.001,1],despill:[0,1],light:[-2,2],lightX:[0,1],lightY:[0,1],lightRadius:[.05,2]};
    if(!v || typeof v!=='object' || Array.isArray(v) || Object.keys(v).length!==Object.keys(SMART_PICTURE).length || Object.keys(v).some(k=>!Object.hasOwn(SMART_PICTURE,k)) || typeof v.keyEnabled!=='boolean' || !/^#[0-9a-f]{6}$/i.test(v.keyColor) || Object.entries(bounds).some(([k,[a,b]])=>!Number.isFinite(v[k]) || v[k]<a || v[k]>b))return helperEnglish('invalid_local_picture_processing');
    return null;
}
const chroma=(r,g,b)=>[-.168736*r-.331264*g+.5*b,.5*r-.418688*g-.081312*b];
/** Separable bilateral filtering reduces small noise while preserving strong edges and source alpha. */
export function denoisePixels(data,width,height,amount) {
    if(!amount)return data;
    const source=new Uint8ClampedArray(data),scratch=new Uint8ClampedArray(data.length),sigma=10+amount*35,table=Float32Array.from({length:256},(_,d)=>Math.exp(-d*d/(2*sigma*sigma)));
    for(const [input,output,vertical] of [[source,scratch,false],[scratch,data,true]]) {
        for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
            const i=(y*width+x)*4;
            for(let c=0;c<3;c++){let sum=input[i+c],weight=1;for(const shift of [-1,1]){const xx=vertical?x:clamp(x+shift,0,width-1),yy=vertical?clamp(y+shift,0,height-1):y,j=(yy*width+xx)*4;if(!input[j+3])continue;const w=.8*table[Math.abs(input[i+c]-input[j+c])];sum+=input[j+c]*w;weight+=w;}output[i+c]=Math.round(sum/weight);}
            output[i+3]=input[i+3];
        }
    }
    for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)data[i+c]=Math.round(source[i+c]*(1-amount)+data[i+c]*amount);
    return data;
}
export function smartPicturePixels(data,width,height,settings) {
    const s={...SMART_PICTURE,...settings};denoisePixels(data,width,height,s.denoise);
    const key=s.keyColor.slice(1).match(/../g).map(v=>parseInt(v,16)),[ku,kv]=chroma(...key),dominant=key.indexOf(Math.max(...key)),others=[0,1,2].filter(c=>c!==dominant);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
        const i=(y*width+x)*4;
        if(s.keyEnabled){const [u,v]=chroma(data[i],data[i+1],data[i+2]),distance=Math.hypot(u-ku,v-kv)/180,alpha=clamp((distance-s.keyTolerance)/s.keyFeather),p=alpha*alpha*(3-2*alpha);data[i+3]=Math.round(data[i+3]*p);if(p<1){const neutral=Math.max(data[i+others[0]],data[i+others[1]]);data[i+dominant]-=Math.max(0,data[i+dominant]-neutral)*(1-p)*s.despill;}}
        if(s.light){const d=Math.hypot(x/width-s.lightX,y/height-s.lightY),gain=2**(s.light*Math.exp(-d*d/(2*s.lightRadius*s.lightRadius)));for(let c=0;c<3;c++)data[i+c]=Math.round(clamp(data[i+c]*gain,0,255));}
    }
    return data;
}
export const smartPictureActive=s=>s && (s.denoise || s.keyEnabled || s.light);
export function smartPicture(pic,crop,settings,width,height) {
    const ratio=Math.min(1,4096/Math.max(width,height)),w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio)),canvas=new OffscreenCanvas(w,h),g=canvas.getContext('2d',{willReadFrequently:true});
    g.drawImage(pic,pic.width*crop.x,pic.height*crop.y,pic.width*crop.width,pic.height*crop.height,0,0,w,h);const pixels=g.getImageData(0,0,w,h);smartPicturePixels(pixels.data,w,h,settings);g.putImageData(pixels,0,0);return canvas;
}
