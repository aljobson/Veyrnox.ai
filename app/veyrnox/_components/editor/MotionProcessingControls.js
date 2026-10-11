'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { NumberControl } from './EditorFields';
import { processMotionVideo } from '../../_lib/editorMotionVideo.mjs';
const labels={'stabilize':'Stabilize camera shake','flicker':'Reduce exposure flicker','optical-flow':'Optical-flow interpolation','track-reframe':'Track region and reframe','camera-movement':'Camera pan and zoom'};
export function MotionProcessingControls({ media, blob, disabled, timeline, onIngest, onBusy, onError }) {
    const [tool,setTool]=useState('stabilize'),[strength,setStrength]=useState(1),[smoothing,setSmoothing]=useState(10),[aspect,setAspect]=useState(9/16),[region,setRegion]=useState({x:.3,y:.2,width:.3,height:.5});
    const [from,setFrom]=useState({x:.5,y:.5,zoom:1}),[to,setTo]=useState({x:.5,y:.5,zoom:1.5}),[progress,setProgress]=useState(null),[result,setResult]=useState(null),[inserting,setInserting]=useState(false);
    const controller=useRef(null),alive=useRef(true),current=useRef(timeline),source=useRef(blob);
    useLayoutEffect(()=>{current.current=timeline;source.current=blob;controller.current?.abort();},[timeline,blob]);
    useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();onBusy(false);};},[onBusy]);
    useEffect(()=>()=>{if(result)URL.revokeObjectURL(result.url);},[result]);
    async function process(){
        const snapshot=current.current,original=source.current,job=new AbortController();controller.current=job;onBusy(true);setResult(null);setProgress({stage:'analyse',done:0,total:1});
        try{const output=await processMotionVideo(original,{tool,name:media.name,strength,smoothing,aspect,region,from,to,height:tool==='optical-flow'?480:720,signal:job.signal,onProgress:p=>alive.current&&setProgress(p)});if(!alive.current || job.signal.aborted || current.current!==snapshot || source.current!==original)return;setResult({...output,url:URL.createObjectURL(output.blob),snapshot,original});}
        catch(e){if(e.name!=='AbortError' && alive.current)onError(e.message || 'Picture processing failed.');}
        finally{if(controller.current===job){controller.current=null;if(alive.current){setProgress(null);onBusy(false);}}}
    }
    const ready=result?.snapshot===timeline&&result?.original===blob?result:null;
    async function insert(){if(!ready){onError('The edit changed. Process the current source again.');return;}setInserting(true);onBusy(true);try{await onIngest(ready.file,ready.file.name,undefined,undefined,{...(media.attribution?{attribution:media.attribution}:{}),folder:'Processed video'});if(alive.current)setResult(null);}catch(e){if(alive.current)onError(e.message);}finally{if(alive.current){setInserting(false);onBusy(false);}}}
    const locked=disabled || !!progress || inserting;
    return <details><summary className="cursor-pointer text-xs font-bold">Motion and restoration</summary><div className="mt-2 space-y-2">
        <fieldset disabled={locked} className="space-y-2"><label className="block text-xs">Picture operation<select aria-label="Picture operation" value={tool} onChange={e=>setTool(e.target.value)} className="w-full rounded border border-vx-border bg-vx-base p-2">{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        {['stabilize','flicker'].includes(tool) && <NumberControl label="Processing strength" value={strength} min={0} max={1} step={.05} onChange={setStrength} />}
        {['stabilize','flicker','track-reframe'].includes(tool) && <NumberControl label="Motion smoothing frames" value={smoothing} min={1} max={30} step={1} onChange={setSmoothing} />}
        {tool==='track-reframe' && <><label className="block text-xs">Reframe shape<select aria-label="Reframe shape" value={aspect} onChange={e=>setAspect(Number(e.target.value))} className="w-full rounded bg-vx-base p-2"><option value={9/16}>Portrait</option><option value={1}>Square</option><option value={16/9}>Landscape</option></select></label><p className="text-xs">Select the textured region in the source’s first frame. Tracking can lose the region during occlusion or rapid movement.</p>{Object.keys(region).map(key=><NumberControl key={key} label={`Tracking region ${key} (%)`} value={region[key]*100} min={0} max={100} step={1} onChange={n=>setRegion(r=>({...r,[key]:n/100}))} />)}</>}
        {tool==='camera-movement' && [[from,setFrom,'Start'],[to,setTo,'End']].map(([point,set,label])=><div key={label} className="space-y-2">{['x','y','zoom'].map(key=><NumberControl key={key} label={`${label} camera ${key}`} value={point[key]} min={key==='zoom'?1:0} max={key==='zoom'?3:1} step={.05} onChange={value=>set(p=>({...p,[key]:value}))} />)}</div>)}
        <Button size="sm" disabled={!blob || media.kind!=='video'} onClick={process}>Process source video</Button></fieldset>
        <p className="text-xs text-vx-fg-muted">Creates a separate local MP4, preserving AAC audio exactly. Use an AAC or silent video. Up to 30 seconds at 720p; optical flow up to 10 seconds at 480p/60 fps. Stabilization crops edges; optical flow may distort fast motion. The source stays editable.</p>
        {progress && <><progress aria-label="Picture processing progress" max={1} value={progress.done/progress.total} className="w-full" /><p role="status" className="text-xs">{progress.stage==='analyse'?'Analysing motion':'Encoding processed video'}</p><Button size="sm" onClick={()=>controller.current?.abort()}>Cancel picture processing</Button></>}
        {ready && <section aria-label="Processed video result" className="space-y-2 text-xs"><p role="status">Processed video ready · {ready.report.sceneCuts} scene cuts · {Math.round(ready.report.reliableMotionFraction*100)}% reliable motion · {ready.report.trackingLostFrames} lost tracking frames</p>{ready.report.limits.map(limit=><p key={limit}>{limit}</p>)}<a href={ready.url} download={ready.file.name} className="underline">Download processed video</a><Button size="sm" disabled={locked} onClick={insert}>Add processed video to edit</Button></section>}
    </div></details>;
}
