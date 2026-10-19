'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { useEffect,useRef,useState } from 'react';
import { restoreOriginalAudio } from '../../_lib/editorOriginalAudio.mjs';
import { Button } from '../Button';
import { ReviewPanel } from './ReviewPanel';
import { useEditorResource } from './useEditorResource';
import { gatewayFetch } from '../../_lib/gateway';
import { getStoredUserId,onSessionChange } from '../../../lib/authClient';
import { timelineFromDocument,mediaToRelink,matchLocalFile } from '../../_lib/editorProject.mjs';
import { upgradeSequence,sequenceEnd } from '../../_lib/editorSequence.mjs';
import { loadEditorLibraryItem } from '../../_lib/editorLibraryCollection.mjs';
import { loadProjectAssetBlob } from '../../_lib/editorProjectAssets.mjs';
import { checkLocalFile,probeMedia,checkProbe } from '../../_lib/editorMedia.mjs';
import { createPreviewer } from '../../_lib/editorPreview.mjs';
import { createAudioPlayer } from '../../_lib/editorPlayback.mjs';
import { timelineSize } from '../../_lib/editorRender.mjs';
import { formatTime } from '../../_lib/editorTimeline.mjs';
export function ReviewWorkspace({projectId,revision}) {
  const { t, locale } = useI18n();
    const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
    const time = value => locale === 'en' ? formatTime(value) : formatTime(value).replace(/\d+/g, part => new Intl.NumberFormat(localeTag(locale), {useGrouping:false,minimumIntegerDigits:part.length}).format(Number(part)));
    const resource=useEditorResource(`/projects/${projectId}/document?revision=${revision}`),blobs=useRef(new Map()),canvas=useRef(null),preview=useRef(null),player=useRef(null),generation=useRef(0),loadingGeneration=useRef(0),alive=useRef(true);
    const [timeline,setTimeline]=useState(null),[frame,setFrame]=useState(0),[playing,setPlaying]=useState(false),[preparing,setPreparing]=useState(false),[missing,setMissing]=useState([]),[error,setError]=useState(''),[tick,setTick]=useState(0);
    const pause=()=>{generation.current++;player.current?.stop();setPlaying(false);setPreparing(false);};
    const seek=at=>{pause();setFrame(Math.max(0,Math.min(at,Math.max(0,sequenceEnd(timeline)-1))));};
    useEffect(()=>{const life=alive,frames=generation,loads=loadingGeneration,files=blobs.current;life.current=true;return()=>{life.current=false;frames.current++;loads.current++;preview.current?.dispose();player.current?.dispose();files.clear();};},[]);
    useEffect(()=>{let account=getStoredUserId();return onSessionChange(s=>{if(account===s?.user?.id)return;account=s?.user?.id;generation.current++;loadingGeneration.current++;player.current?.dispose();player.current=null;preview.current?.dispose();preview.current=null;blobs.current.clear();setTimeline(null);setPlaying(false);setPreparing(false);setMissing([]);setError(t("app.editor.review.accountChanged"));});},[t]);
    useEffect(()=>{
        if(!resource.data)return;const ticket=++loadingGeneration.current;
        void (async()=>{
            await Promise.resolve();if(!alive.current || ticket!==loadingGeneration.current)return;
            generation.current++;player.current?.dispose();player.current=null;preview.current?.dispose();preview.current=null;blobs.current.clear();setPlaying(false);setPreparing(false);setFrame(0);
            const opened=timelineFromDocument(resource.data.document);if(opened.problem){setTimeline(null);setMissing([]);setError(t("app.editor.review.invalid"));return;}
            const tl=upgradeSequence(opened.timeline);restoreOriginalAudio(tl,blobs.current);const need=mediaToRelink(tl);setTimeline(tl);setError('');setMissing([...need.local,...need.library,...need.assets]);
            for(const item of [...need.library,...need.assets]){try{
                const result=item.assetId?await loadProjectAssetBlob(gatewayFetch,{projectId:item.projectId,assetId:item.assetId}):await loadEditorLibraryItem(gatewayFetch,item,{actor:getStoredUserId() || 'guest',isCurrent:()=>alive.current && ticket===loadingGeneration.current});
                if(!alive.current || ticket!==loadingGeneration.current)return;blobs.current.set(item.id,result.blob);
            }catch{/* unavailable sources remain visibly missing */}}
            if(alive.current && ticket===loadingGeneration.current){const remaining=mediaToRelink(tl,new Set(blobs.current.keys()));setMissing([...remaining.local,...remaining.library,...remaining.assets]);setTick(n=>n+1);}
        })();
        const loads=loadingGeneration;return()=>{loads.current++;};
    },[resource.data,t]);
    useEffect(()=>{if(!timeline || !canvas.current)return;preview.current ||= createPreviewer(blobs.current);void preview.current.draw(timeline,frame,canvas.current).catch(()=>setError(t("app.editor.review.frameFailed")));},[timeline,frame,tick,t]);
    useEffect(()=>{if(!playing || !timeline)return;let raf;const step=()=>{const at=player.current.frame(),end=sequenceEnd(timeline);setFrame(Math.min(at,end-1));if(at>=end){player.current.stop();setPlaying(false);}else raf=requestAnimationFrame(step);};raf=requestAnimationFrame(step);return()=>cancelAnimationFrame(raf);},[playing,timeline]);
    async function play(){if(playing || preparing){pause();return;}player.current ||= createAudioPlayer();const ticket=++generation.current,at=frame>=sequenceEnd(timeline)-1?0:frame;setFrame(at);setPreparing(true);try{if(await player.current.start(timeline,blobs.current,at) && alive.current && ticket===generation.current)setPlaying(true);}catch(e){if(ticket===generation.current)setError(e.message);}finally{if(ticket===generation.current)setPreparing(false);}}
    async function relink(event){const file=event.target.files[0];event.target.value='';if(!file)return;const problem=checkLocalFile(file);if(problem.error){setError(problem.error);return;}const ticket=loadingGeneration.current;let probe;try{probe=await probeMedia(file);}catch{if(alive.current && ticket===loadingGeneration.current)setError(t("app.editor.review.sourceFailed"));return;}const bad=checkProbe(probe);if(bad){setError(bad);return;}if(!alive.current || ticket!==loadingGeneration.current)return;const media=matchLocalFile(timeline,file,probe,new Set(blobs.current.keys()));if(!media){setError(t("app.editor.review.match"));return;}blobs.current.set(media.id,file);const need=mediaToRelink(timeline,new Set(blobs.current.keys()));setMissing([...need.local,...need.library,...need.assets]);setTick(n=>n+1);setError('');}
    const size=timeline?timelineSize(timeline,720):{width:1280,height:720},total=timeline?sequenceEnd(timeline):0,project={id:projectId,revision,dirty:false};
    return <div className="space-y-4"><h1 className="text-2xl font-bold">{t('app.editor.review.version', {number:number(revision)})}</h1><p className="text-sm">{t("app.editor.review.workspaceHelp")}</p>
        {(resource.error || error) && <p role="alert">{resource.error || error}</p>}{resource.busy && <p role="status">{t("app.editor.review.loading")}</p>}
        {missing.length>0 && <section aria-label={t("app.editor.review.missingTitle")} className="rounded border border-vx-border p-3"><p role="status">{t(pluralKey(t, locale, 'app.editor.review.missing', missing.length), {count:number(missing.length)})}</p><ul>{missing.map(m=><li key={m.id}>{m.name}</li>)}</ul><label className="text-vx-accent underline">{t("app.editor.review.choose")}<input className="sr-only" aria-label={t("app.editor.review.relink")} type="file" onChange={relink} /></label></section>}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]"><section className="space-y-3"><canvas ref={canvas} width={size.width} height={size.height} role="img" aria-label={t("app.editor.review.preview")} className="max-h-[65vh] w-full bg-black object-contain" /><div className="flex gap-3"><Button disabled={!timeline || !total || missing.length>0} onClick={play}>{playing || preparing?t("cinema.videoUpload.pause"):t("cinema.titlePage.play")}</Button><input aria-label={t("app.editor.review.playhead")} type="range" min={0} max={Math.max(0,total-1)} value={frame} disabled={!timeline} onChange={e=>seek(Number(e.target.value))} className="min-w-0 flex-1" /><span className="text-xs">{time(frame)} / {time(total)}</span></div></section><aside><ReviewPanel project={project} frame={frame} disabled={!timeline || resource.busy} onSeek={seek} /></aside></div>
    </div>;
}
