// The live preview figure. The web draws a stylised mannequin from pure geometry (picks in, SVG shapes out). The app has
// no SVG library, so the same geometry (FIGURE_SCRIPT, generated from the web files) runs inside a WebView that loads
// no network content, and this file builds the page and the call that redraws it. The figure is a stand-in: the real
// picture is made by the model from the same picks.
import { FIGURE_SCRIPT } from './oddlings/figureScript';
import { sanitizePicks, type Picks } from './oddlingsBuilder';

// Shapes to SVG text. Only known tags and plain attribute names pass, and values are escaped, so nothing a pick holds
// can become markup.
export const DRAW_SCRIPT = `
const __TAGS={circle:1,ellipse:1,path:1,rect:1,line:1,polygon:1,polyline:1};
const __esc=(v)=>String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const __kebab=(k)=>k.replace(/[A-Z]/g,(c)=>'-'+c.toLowerCase());
function svgFor(picks,focus){
  const p=picks||{};
  const shapes=__f.mannequinShapes(p);
  const body=shapes.map((s)=>{
    if(!__TAGS[s.tag])return '';
    const a=Object.assign({},s.attrs);
    if(s.fill!==undefined)a.fill=s.fill;
    if(s.stroke)a.stroke=s.stroke;
    if(s.opacity)a.opacity=s.opacity;
    return '<'+s.tag+Object.keys(a).filter((k)=>/^[a-zA-Z]+$/.test(k)).map((k)=>' '+__kebab(k)+'="'+__esc(a[k])+'"').join('')+'/>';
  }).join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+__esc(__f.mannequinViewBox(focus||'body',p))+'" preserveAspectRatio="xMidYMid meet">'+body+'</svg>';
}
if(typeof window!=='undefined'){window.draw=function(p,f){document.getElementById('f').innerHTML=svgFor(p,f);};}
`;

const LINE_SEP = new RegExp(String.fromCharCode(0x2028), 'g');
const PARA_SEP = new RegExp(String.fromCharCode(0x2029), 'g');
export const FIGURE_BACKGROUND = '#141416';

export function figureHtml(): string {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:${FIGURE_BACKGROUND};overflow:hidden}#f,svg{width:100%;height:100%;display:block}</style></head><body><div id="f"></div><script>${FIGURE_SCRIPT}\n${DRAW_SCRIPT}</script></body></html>`;
}

// The script that redraws the page for these picks. The picks are cleaned first and sent as JSON.
export function figureCall(picks: Picks, focus = 'body'): string {
    const safe = JSON.stringify(sanitizePicks(picks)).replace(/</g, '\\u003c').replace(LINE_SEP, '\\u2028').replace(PARA_SEP, '\\u2029');
    return `window.draw(${safe},${JSON.stringify(/^[a-zA-Z]{1,12}$/.test(focus) ? focus : 'body')});true;`;
}

// Used by tests: the same drawing code, without a page.
export function svgForPicks(picks: Picks, focus = 'body'): string {
    return new Function(`${FIGURE_SCRIPT}\n${DRAW_SCRIPT}\nreturn svgFor;`)()(sanitizePicks(picks), focus) as string;
}
