// Frozen legacy SVG serializer. Eval is confined to Jest.
import { FIGURE_SCRIPT } from '../../src/lib/oddlings/figureScript';
import { sanitizePicks, type Picks } from '../../src/lib/oddlingsBuilder';
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


export function legacySvgForPicks(picks: Picks, focus = 'body'): string {
    return new Function(`${FIGURE_SCRIPT}\n${DRAW_SCRIPT}\nreturn svgFor;`)()(sanitizePicks(picks), focus);
}
