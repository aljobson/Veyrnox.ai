'use client';
import { useRef,useState } from 'react';
import { Button } from '../Button';
import { ANIMATIONS } from '../../_lib/editorSequenceValidation.mjs';
import { evaluatedTransform,COMBOS,EASINGS,motionPreset,parameterKeyframe } from '../../_lib/editorAnimation.mjs';
import { NumberControl,SelectControl } from './EditorFields';
export function AnimationControls({item,onChange}) {
    const a=item.animation || {in:'none',out:'none',duration:15},set=(key,value)=>onChange({animation:{...a,[key]:value}});
    return <details><summary className="cursor-pointer text-xs font-bold">Animation</summary><div className="mt-2 space-y-2">
        <SelectControl label="Animation in" value={a.in} options={ANIMATIONS} onChange={v=>set('in',v)} /><SelectControl label="Animation out" value={a.out} options={ANIMATIONS} onChange={v=>set('out',v)} />
        <NumberControl label="Animation duration (seconds)" value={a.duration/30} min={1/30} max={4} onChange={n=>set('duration',Math.round(n*30))} />
        <SelectControl label="Combo animation" value={a.combo||'none'} options={COMBOS} onChange={v=>set('combo',v)} />
        {(a.combo && a.combo!=='none') && <><NumberControl label="Combo period (seconds)" value={(a.period||60)/30} min={1/30} max={600} onChange={n=>set('period',Math.round(n*30))} /><NumberControl label="Combo strength (%)" value={(a.amount??.5)*100} min={0} max={100} onChange={n=>set('amount',n/100)} /></>}
    </div></details>;
}
const limits={x:[-200,300],y:[-200,300],scale:[5,800],rotation:[-360,360],opacity:[0,100]};
export function MotionControls({item,frame,onChange}) {
    const [preset,setPreset]=useState('pan-right'),drag=useRef(null),[ghost,setGhost]=useState(null),keys=item.keyframes||[],at=frame-item.start;
    const set=(index,key,value)=>onChange({keyframes:keys.map((k,i)=>i===index?{...k,[key]:value}:k).sort((a,b)=>a.frame-b.frame)});
    const points=keys.map((k,i)=>({...k,...(ghost?.index===i?ghost:null)}));
    return <details><summary className="cursor-pointer text-xs font-bold">Motion path and keyframes</summary><div className="mt-2 space-y-2">
        <SelectControl label="Motion path preset" value={preset} options={['pan-right','rise','arc','push-in']} onChange={setPreset} />
        <Button size="sm" onClick={()=>onChange({keyframes:motionPreset(item,preset)})}>Apply motion path</Button>
        <svg role="img" aria-label="Editable motion path" viewBox="0 0 100 100" className="w-full touch-none border border-vx-border">
            <path d="M50 0V100M0 50H100" stroke="#475569" strokeWidth=".5" /><polyline points={points.map(k=>`${k.x*100},${k.y*100}`).join(' ')} fill="none" stroke="#2dd4bf" />
            {points.map((k,i)=><circle key={i} role="button" aria-label={`Drag motion point ${i+1}`} tabIndex={0} cx={k.x*100} cy={k.y*100} r="3" fill="#ffffff" className="cursor-move"
                onPointerDown={e=>{e.preventDefault();drag.current={index:i,bounds:e.currentTarget.closest('svg').getBoundingClientRect()};e.currentTarget.setPointerCapture(e.pointerId);}}
                onPointerMove={e=>{const d=drag.current;if(!d)return;setGhost({index:i,x:Math.max(-2,Math.min(3,(e.clientX-d.bounds.left)/d.bounds.width)),y:Math.max(-2,Math.min(3,(e.clientY-d.bounds.top)/d.bounds.height))});}}
                onPointerUp={()=>{if(drag.current && ghost)onChange({keyframes:keys.map((p,j)=>j===i?{...p,x:ghost.x,y:ghost.y}:p)});drag.current=null;setGhost(null);}}
                onPointerCancel={()=>{drag.current=null;setGhost(null);}}
                onKeyDown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();const key=e.key==='ArrowLeft'||e.key==='ArrowRight'?'x':'y';set(i,key,Math.max(-2,Math.min(3,k[key]+(e.key==='ArrowLeft'||e.key==='ArrowUp'?-.01:.01))));}}} />)}
        </svg>
        <Button size="sm" disabled={at<0||at>=item.len||keys.length>=40} onClick={()=>{const t=evaluatedTransform(item,at,false);onChange({keyframes:[...keys.filter(k=>k.frame!==at),{frame:at,x:t.x,y:t.y,scale:t.scale,rotation:t.rotation,opacity:t.opacity,easing:'linear'}].sort((a,b)=>a.frame-b.frame)});}}>Add keyframe at playhead</Button>
        {keys.map((k,i)=><details key={i}><summary className="cursor-pointer text-xs">Motion point {i+1} · {(k.frame/30).toFixed(2)}s</summary><div className="mt-2 space-y-2">
            <NumberControl label={`Motion point ${i+1} time (seconds)`} value={k.frame/30} min={-600} max={600} onChange={n=>set(i,'frame',Math.round(n*30))} />
            {Object.entries(limits).map(([key,[min,max]])=><NumberControl key={key} label={`Motion point ${i+1} ${key}${key==='rotation'?' (degrees)':' (%)'}`} value={k[key]*(key==='rotation'?1:100)} min={min} max={max} onChange={n=>set(i,key,n/(key==='rotation'?1:100))} />)}
            <SelectControl label={`Easing at frame ${k.frame}`} value={k.easing} options={EASINGS} onChange={v=>set(i,'easing',v)} /><Button size="sm" onClick={()=>onChange({keyframes:keys.filter((_,j)=>j!==i)})}>Delete motion point {i+1}</Button>
        </div></details>)}
        <Button size="sm" variant="ghost" onClick={()=>onChange({keyframes:[]})}>Clear motion path</Button>
        <p className="text-xs text-vx-fg-muted">Drag path points or edit their position, scale, rotation and opacity. Splits and trims retain the original motion.</p>
    </div></details>;
}
export function ParameterControls({item,frame,onChange}) {
    const keys=item.parameterKeyframes||[],at=frame-item.start;
    return <details><summary className="cursor-pointer text-xs font-bold">Animated colour and blur</summary><div className="mt-2 space-y-2">
        <Button size="sm" disabled={at<0||at>=item.len||keys.length>=40} onClick={()=>onChange({parameterKeyframes:[...keys.filter(k=>k.frame!==at),parameterKeyframe(item,at)].sort((a,b)=>a.frame-b.frame)})}>Add picture keyframe at playhead</Button>
        <p className="text-xs text-vx-fg-muted">With picture keys enabled, colour, exposure, temperature, tint and blur controls add a key at the current playhead.</p>
        {keys.map(k=><div key={k.frame} className="space-y-1 text-xs"><span>{(k.frame/30).toFixed(2)}s</span><SelectControl label={`Picture easing at frame ${k.frame}`} value={k.easing} options={EASINGS} onChange={v=>onChange({parameterKeyframes:keys.map(p=>p.frame===k.frame?{...p,easing:v}:p)})} /><button type="button" onClick={()=>onChange({parameterKeyframes:keys.filter(p=>p.frame!==k.frame)})}>Delete picture key at {k.frame}</button></div>)}
        <Button size="sm" variant="ghost" onClick={()=>onChange({parameterKeyframes:[]})}>Clear picture keyframes</Button>
    </div></details>;
}
