'use client';
import { useEffect,useRef,useState } from 'react';
import { restoreOriginalAudio } from '../../_lib/editorOriginalAudio.mjs';
import { Button } from '../Button';
import { ReviewPanel } from './ReviewPanel';
import { useEditorResource } from './useEditorResource';
import { gatewayFetch } from '../../_lib/gateway';
import { getStoredUserId,onSessionChange } from '../../../lib/authClient';
import { timelineFromDocument,mediaToRelink,matchLocalFile } from '../../_lib/editorProject.mjs';
import { upgradeSequence,sequenceEnd } from '../../_lib/editorSequence.mjs';
import { loadLibraryBlob } from '../../_lib/editorLibrary.mjs';
import { loadProjectAssetBlob } from '../../_lib/editorProjectAssets.mjs';
import { checkLocalFile,probeMedia,checkProbe } from '../../_lib/editorMedia.mjs';
import { createPreviewer } from '../../_lib/editorPreview.mjs';
import { createAudioPlayer } from '../../_lib/editorPlayback.mjs';
import { timelineSize } from '../../_lib/editorRender.mjs';
import { formatTime } from '../../_lib/editorTimeline.mjs';
export function ReviewWorkspace({projectId,revision}) {
    const resource=useEditorResource(`/projects/${projectId}/document?revision=${revision}`),blobs=useRef(new Map()),canvas=useRef(null),preview=useRef(null),player=useRef(null),generation=useRef(0),loadingGeneration=useRef(0),alive=useRef(true);
    const [timeline,setTimeline]=useState(null),[frame,setFrame]=useState(0),[playing,setPlaying]=useState(false),[preparing,setPreparing]=useState(false),[missing,setMissing]=useState([]),[error,setError]=useState(''),[tick,setTick]=useState(0);
    const pause=()=>{generation.current++;player.current?.stop();setPlaying(false);setPreparing(false);};
    const seek=at=>{pause();setFrame(Math.max(0,Math.min(at,Math.max(0,sequenceEnd(timeline)-1))));};
    useEffect(()=>{const life=alive,frames=generation,loads=loadingGeneration,files=blobs.current;life.current=true;return()=>{life.current=false;frames.current++;loads.current++;preview.current?.dispose();player.current?.dispose();files.clear();};},[]);
    useEffect(()=>{let account=getStoredUserId();return onSessionChange(s=>{if(account===s?.user?.id)return;account=s?.user?.id;generation.current++;loadingGeneration.current++;player.current?.dispose();player.current=null;preview.current?.dispose();preview.current=null;blobs.current.clear();setTimeline(null);setPlaying(false);setPreparing(false);setMissing([]);setError('Account changed. Reopen the review from the current account.');});},[]);
    useEffect(()=>{
        if(!resource.data)return;const ticket=++loadingGeneration.current;
        void (async()=>{
            await Promise.resolve();if(!alive.current || ticket!==loadingGeneration.current)return;
            generation.current++;player.current?.dispose();player.current=null;preview.current?.dispose();preview.current=null;blobs.current.clear();setPlaying(false);setPreparing(false);setFrame(0);
            const opened=timelineFromDocument(resource.data.document);if(opened.problem){setTimeline(null);setMissing([]);setError('This saved timeline is invalid and cannot be reviewed.');return;}
            const tl=upgradeSequence(opened.timeline);restoreOriginalAudio(tl,blobs.current);const need=mediaToRelink(tl);setTimeline(tl);setError('');setMissing([...need.local,...need.library,...need.assets]);
            for(const item of [...need.library,...need.assets]){try{
                const result=item.assetId?await loadProjectAssetBlob(gatewayFetch,{projectId:item.projectId,assetId:item.assetId}):await loadLibraryBlob(gatewayFetch,item.jobId);
                if(!alive.current || ticket!==loadingGeneration.current)return;blobs.current.set(item.id,result.blob);
            }catch{/* unavailable sources remain visibly missing */}}
            if(alive.current && ticket===loadingGeneration.current){const remaining=mediaToRelink(tl,new Set(blobs.current.keys()));setMissing([...remaining.local,...remaining.library,...remaining.assets]);setTick(n=>n+1);}
        })();
        const loads=loadingGeneration;return()=>{loads.current++;};
    },[resource.data]);
    useEffect(()=>{if(!timeline || !canvas.current)return;preview.current ||= createPreviewer(blobs.current);void preview.current.draw(timeline,frame,canvas.current).catch(()=>setError('A source frame could not be decoded.'));},[timeline,frame,tick]);
    useEffect(()=>{if(!playing || !timeline)return;let raf;const step=()=>{const at=player.current.frame(),end=sequenceEnd(timeline);setFrame(Math.min(at,end-1));if(at>=end){player.current.stop();setPlaying(false);}else raf=requestAnimationFrame(step);};raf=requestAnimationFrame(step);return()=>cancelAnimationFrame(raf);},[playing,timeline]);
    async function play(){if(playing || preparing){pause();return;}player.current ||= createAudioPlayer();const ticket=++generation.current,at=frame>=sequenceEnd(timeline)-1?0:frame;setFrame(at);setPreparing(true);try{if(await player.current.start(timeline,blobs.current,at) && alive.current && ticket===generation.current)setPlaying(true);}catch(e){if(ticket===generation.current)setError(e.message);}finally{if(ticket===generation.current)setPreparing(false);}}
    async function relink(event){const file=event.target.files[0];event.target.value='';if(!file)return;const problem=checkLocalFile(file);if(problem.error){setError(problem.error);return;}const ticket=loadingGeneration.current;let probe;try{probe=await probeMedia(file);}catch{if(alive.current && ticket===loadingGeneration.current)setError('That source could not be decoded.');return;}const bad=checkProbe(probe);if(bad){setError(bad);return;}if(!alive.current || ticket!==loadingGeneration.current)return;const media=matchLocalFile(timeline,file,probe,new Set(blobs.current.keys()));if(!media){setError('Choose a matching original file with the same name and duration.');return;}blobs.current.set(media.id,file);const need=mediaToRelink(timeline,new Set(blobs.current.keys()));setMissing([...need.local,...need.library,...need.assets]);setTick(n=>n+1);setError('');}
    const size=timeline?timelineSize(timeline,720):{width:1280,height:720},total=timeline?sequenceEnd(timeline):0,project={id:projectId,revision,dirty:false};
    return <div className="space-y-4"><h1 className="text-2xl font-bold">Review saved version {revision}</h1><p className="text-sm">This view leaves the saved edit unchanged. The link uses the project’s existing access permissions.</p>
        {(resource.error || error) && <p role="alert">{resource.error || error}</p>}{resource.busy && <p role="status">Loading saved edit…</p>}
        {missing.length>0 && <section aria-label="Missing review sources" className="rounded border border-vx-border p-3"><p role="status">{missing.length} sources are unavailable. The preview is incomplete until they are relinked.</p><ul>{missing.map(m=><li key={m.id}>{m.name}</li>)}</ul><label className="text-vx-accent underline">Choose an original source<input className="sr-only" aria-label="Relink review source" type="file" onChange={relink} /></label></section>}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]"><section className="space-y-3"><canvas ref={canvas} width={size.width} height={size.height} role="img" aria-label="Saved edit preview" className="max-h-[65vh] w-full bg-black object-contain" /><div className="flex gap-3"><Button disabled={!timeline || !total || missing.length>0} onClick={play}>{playing || preparing?'Pause':'Play'}</Button><input aria-label="Review playhead" type="range" min={0} max={Math.max(0,total-1)} value={frame} disabled={!timeline} onChange={e=>seek(Number(e.target.value))} className="min-w-0 flex-1" /><span className="text-xs">{formatTime(frame)} / {formatTime(total)}</span></div></section><aside><ReviewPanel project={project} frame={frame} disabled={!timeline || resource.busy} onSeek={seek} /></aside></div>
    </div>;
}
