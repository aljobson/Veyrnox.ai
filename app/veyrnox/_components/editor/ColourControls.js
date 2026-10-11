'use client';
import { useState } from 'react';
import { Button } from '../Button';
import { NumberControl,SelectControl } from './EditorFields';
import { colourDefaults,HSL_CHANNELS,CURVE_CHANNELS,curveValue } from '../../_lib/editorColour.mjs';
export function ColourControls({item,onChange}) {
    const [hslChannel,setHslChannel]=useState('red'),[curveChannel,setCurveChannel]=useState('master'),c=item.colourAdjustment || colourDefaults();
    const set=(key,value)=>onChange({colourAdjustment:{...c,[key]:value}}),points=c.curves[curveChannel];
    const curve=next=>set('curves',{...c.curves,[curveChannel]:next});
    return <div className="space-y-2">
        {['exposure','temperature','tint','shadows','highlights','gamma'].map(key=><NumberControl key={key} label={key==='exposure'?'Exposure (stops)':key[0].toUpperCase()+key.slice(1)} value={c[key]} min={key==='exposure'?-3:key==='gamma'?.1:-1} max={key==='exposure'?3:key==='gamma'?4:1} onChange={n=>set(key,n)} />)}
        <details><summary className="cursor-pointer text-xs font-bold">HSL channels</summary><div className="mt-2 space-y-2"><SelectControl label="HSL channel" value={hslChannel} options={HSL_CHANNELS} onChange={setHslChannel} />
        {['hue','saturation','luminance'].map(key=><NumberControl key={key} label={`Channel ${key}`} value={c.hsl[hslChannel][key]} min={key==='hue'?-180:-1} max={key==='hue'?180:1} onChange={n=>set('hsl',{...c.hsl,[hslChannel]:{...c.hsl[hslChannel],[key]:n}})} />)}
        </div></details>
        <details><summary className="cursor-pointer text-xs font-bold">Colour curves</summary><div className="mt-2 space-y-2"><SelectControl label="Curve channel" value={curveChannel} options={CURVE_CHANNELS} onChange={setCurveChannel} />
        <svg role="img" aria-label={`${curveChannel} colour curve`} viewBox="0 0 100 100" className="w-full border border-vx-border"><path d="M0 100L100 0" fill="none" stroke="#64748b" /><polyline points={points.map(p=>`${p.x*100},${100-p.y*100}`).join(' ')} fill="none" stroke="#2dd4bf" strokeWidth="2" />{points.map((p,i)=><circle key={i} cx={p.x*100} cy={100-p.y*100} r="2" fill="#ffffff" />)}</svg>
        {points.map((p,i)=><div key={i} className="grid grid-cols-2 gap-2"><NumberControl label={`Curve input ${i+1} (%)`} disabled={i===0 || i===points.length-1} value={p.x*100} min={i?points[i-1].x*100+.1:0} max={i===points.length-1?100:points[i+1].x*100-.1} onChange={n=>{if(i===0 || i===points.length-1)return;curve(points.map((v,k)=>k===i?{...v,x:n/100}:v));}} /><NumberControl label={`Curve output ${i+1} (%)`} value={p.y*100} min={0} max={100} onChange={n=>curve(points.map((v,k)=>k===i?{...v,y:n/100}:v))} />{i>0 && i<points.length-1 && <button aria-label={`Delete curve point ${i+1}`} type="button" className="text-xs" onClick={()=>curve(points.filter((_,k)=>k!==i))}>Remove point</button>}</div>)}
        <Button size="sm" disabled={points.length>=8} onClick={()=>{const gap=points.slice(1).map((p,i)=>({x:(p.x+points[i].x)/2,size:p.x-points[i].x})).sort((a,b)=>b.size-a.size)[0];curve([...points,{x:gap.x,y:curveValue(points,gap.x)}].sort((a,b)=>a.x-b.x));}}>Add curve point</Button>
        <Button size="sm" variant="ghost" onClick={()=>curve([{x:0,y:0},{x:1,y:1}])}>Reset curve channel</Button></div></details>
        <Button size="sm" variant="ghost" onClick={()=>onChange({colourAdjustment:colourDefaults()})}>Reset advanced colour</Button>
    </div>;
}
