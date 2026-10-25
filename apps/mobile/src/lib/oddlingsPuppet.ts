// The animated preview on a character sheet. The web warps the portrait with a small WebGL shader (blink, breath, nod,
// arm and weight shifts); the same code (PUPPET_SCRIPT, generated from the web files) runs here inside a WebView that
// loads no network content. The portrait is handed to the page as a data address, so the page needs no network at all.
// It draws on the phone, makes no sound, uses no model and costs no credits.
import { PUPPET_SCRIPT } from './oddlings/puppetScript';
import { findOddling } from './oddlings';

export const PUPPET_BACKGROUND = '#141416';
// A cast portrait is about 80 KB; anything over this is refused rather than handed to the page.
export const PORTRAIT_BYTES_MAX = 5 * 1024 * 1024;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Hermes has btoa today, but jest and older engines may not; this is small enough to own.
export function toBase64(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i];
        const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
        const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
        out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
        out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
        out += i + 2 < bytes.length ? B64[c & 63] : '=';
    }
    return out;
}

// A WebP is "RIFF", four size bytes, then "WEBP". Anything else is never handed to the page.
export function isWebp(bytes: Uint8Array): boolean {
    const at = (i: number, text: string) => [...text].every((ch, k) => bytes[i + k] === ch.charCodeAt(0));
    return bytes.length > 12 && bytes.length <= PORTRAIT_BYTES_MAX && at(0, 'RIFF') && at(8, 'WEBP');
}

export function portraitDataUri(bytes: Uint8Array): string | null {
    return isWebp(bytes) ? `data:image/webp;base64,${toBase64(bytes)}` : null;
}

// Runs inside the page. The page tells the app 'ready' once the first frame is drawn and 'failed' when it cannot
// (no WebGL, a lost context, a portrait the renderer refuses); the app then keeps the still picture.
const RUNTIME = `
const __p=__m.oddlingPuppetRenderer,__r=__m.oddlingPuppetRigs;
const __c=document.getElementById('c');
let __renderer=null,__raf=null,__on=false,__t=0,__prev=null,__last=0;
function __post(s){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(s);}
function __stop(){__on=false;if(__raf!==null)cancelAnimationFrame(__raf);__raf=null;__prev=null;}
function __frame(ts){
  __raf=null;if(!__on||!__renderer)return;
  if(__prev!==null)__t+=Math.min(100,ts-__prev)/1000;
  __prev=ts;
  if(ts-__last>=32){if(!__renderer.render(__t)){__stop();__post('failed');return;}__last=ts;}
  __raf=requestAnimationFrame(__frame);
}
window.setPlaying=function(v){
  if(!v){__stop();return;}
  if(!__on&&__renderer){__on=true;__raf=requestAnimationFrame(__frame);}
};
window.start=function(src,id,play){
  __stop();__t=0;
  if(__renderer){__renderer.destroy();__renderer=null;}
  const rig=__r.puppetRig(id);
  if(!rig){__post('failed');return;}
  const img=new Image();
  img.onload=function(){
    try{__renderer=__p.createOddlingPuppet(__c,img,id,rig);if(!__renderer.render(0))throw new Error('lost');__post('ready');window.setPlaying(play);}
    catch(e){__post('failed');}
  };
  img.onerror=function(){__post('failed');};
  img.src=src;
};
__c.addEventListener('webglcontextlost',function(e){e.preventDefault();__stop();__post('failed');});
`;

const LINE_SEP = new RegExp(String.fromCharCode(0x2028), 'g');
const PARA_SEP = new RegExp(String.fromCharCode(0x2029), 'g');
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(LINE_SEP, '\\u2028').replace(PARA_SEP, '\\u2029');

// Nothing but an inline script and a data picture can load; there is no address to reach.
export function puppetHtml(): string {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>html,body{margin:0;height:100%;background:${PUPPET_BACKGROUND};overflow:hidden}#c{width:100%;height:100%;object-fit:cover;display:block}</style></head><body><canvas id="c" width="512" height="768"></canvas><script>${PUPPET_SCRIPT}\n${RUNTIME}</script></body></html>`;
}

// Starts the preview for one curated cast character, so nothing else reaches the page.
export function puppetStart(id: string, dataUri: string, play: boolean): string | null {
    if (!findOddling(id) || !dataUri.startsWith('data:image/webp;base64,')) return null;
    return `window.start(${json(dataUri)},${json(id)},${play ? 'true' : 'false'});true;`;
}

export const puppetPlaying = (play: boolean): string => `window.setPlaying(${play ? 'true' : 'false'});true;`;

// The page's own words back to the app; anything else is ignored.
export function puppetEvent(data: string): 'ready' | 'failed' | null {
    return data === 'ready' || data === 'failed' ? data : null;
}
