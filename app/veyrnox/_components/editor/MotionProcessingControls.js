'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { NumberControl } from './EditorFields';
import { processMotionVideo } from '../../_lib/editorMotionVideo.mjs';
const TOOLS = ['stabilize', 'flicker', 'optical-flow', 'track-reframe', 'camera-movement'];
const CAMERA_KEYS = ['x', 'y', 'zoom'];
const REGION_KEYS = ['x', 'y', 'width', 'height'];
export function MotionProcessingControls({ media, blob, disabled, timeline, onIngest, onBusy, onError }) {
  const { t, locale } = useI18n();
  const number = n => locale === 'en' ? String(n) : n.toLocaleString(localeTag(locale));
    const [tool,setTool]=useState('stabilize'),[strength,setStrength]=useState(1),[smoothing,setSmoothing]=useState(10),[aspect,setAspect]=useState(9/16),[region,setRegion]=useState({x:.3,y:.2,width:.3,height:.5});
    const [from,setFrom]=useState({x:.5,y:.5,zoom:1}),[to,setTo]=useState({x:.5,y:.5,zoom:1.5}),[progress,setProgress]=useState(null),[result,setResult]=useState(null),[inserting,setInserting]=useState(false);
    const controller=useRef(null),alive=useRef(true),current=useRef(timeline),source=useRef(blob);
    useLayoutEffect(()=>{current.current=timeline;source.current=blob;controller.current?.abort();},[timeline,blob]);
    useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();onBusy(false);};},[onBusy]);
    useEffect(()=>()=>{if(result)URL.revokeObjectURL(result.url);},[result]);
    async function process(){
        const snapshot=current.current,original=source.current,job=new AbortController();controller.current=job;onBusy(true);setResult(null);setProgress({stage:'analyse',done:0,total:1});
        try{const output=await processMotionVideo(original,{tool,name:media.name,strength,smoothing,aspect,region,from,to,height:tool==='optical-flow'?480:720,signal:job.signal,onProgress:p=>alive.current&&setProgress(p)});if(!alive.current || job.signal.aborted || current.current!==snapshot || source.current!==original)return;setResult({...output,url:URL.createObjectURL(output.blob),snapshot,original});}
        catch(e){if(e.name!=='AbortError' && alive.current)onError(e.message || t("app.editor.motion.failed"));}
        finally{if(controller.current===job){controller.current=null;if(alive.current){setProgress(null);onBusy(false);}}}
    }
    const ready=result?.snapshot===timeline&&result?.original===blob?result:null;
    async function insert(){if(!ready){onError(t("app.editor.person.changed"));return;}setInserting(true);onBusy(true);try{await onIngest(ready.file,ready.file.name,undefined,undefined,{...(media.attribution?{attribution:media.attribution}:{}),folder:t("app.editor.person.folder")});if(alive.current)setResult(null);}catch(e){if(alive.current)onError(e.message);}finally{if(alive.current){setInserting(false);onBusy(false);}}}
    const locked=disabled || !!progress || inserting;
    return <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.motion.title")}</summary><div className="mt-2 space-y-2">
        <fieldset disabled={locked} className="space-y-2"><label className="block text-xs">{t("app.editor.motion.operation")}<select aria-label={t("app.editor.motion.operation")} value={tool} onChange={e=>setTool(e.target.value)} className="w-full rounded border border-vx-border bg-vx-base p-2">{TOOLS.map(id=><option key={id} value={id}>{t(`app.editor.motion.tool.${id}`)}</option>)}</select></label>
        {['stabilize','flicker'].includes(tool) && <NumberControl label={t("app.editor.motion.strength")} value={strength} min={0} max={1} step={.05} onChange={setStrength} />}
        {['stabilize','flicker','track-reframe'].includes(tool) && <NumberControl label={t("app.editor.motion.smoothing")} value={smoothing} min={1} max={30} step={1} onChange={setSmoothing} />}
        {tool==='track-reframe' && <><label className="block text-xs">{t("app.editor.motion.shape")}<select aria-label={t("app.editor.motion.shape")} value={aspect} onChange={e=>setAspect(Number(e.target.value))} className="w-full rounded bg-vx-base p-2"><option value={9/16}>{t("app.editor.person.portrait")}</option><option value={1}>{t("app.editor.person.square")}</option><option value={16/9}>{t("app.editor.person.landscape")}</option></select></label><p className="text-xs">{t("app.editor.motion.regionHelp")}</p>{REGION_KEYS.map(key=><NumberControl key={key} label={t(`app.editor.motion.region.${key}`)} value={region[key]*100} min={0} max={100} step={1} onChange={n=>setRegion(r=>({...r,[key]:n/100}))} />)}</>}
        {tool==='camera-movement' && [[from,setFrom,0],[to,setTo,1]].map(([point,set,label])=><div key={label} className="space-y-2">{CAMERA_KEYS.map(key=><NumberControl key={key} label={t(`app.editor.motion.camera.${label ? 'end' : 'start'}.${key}`)} value={point[key]} min={key==='zoom'?1:0} max={key==='zoom'?3:1} step={.05} onChange={value=>set(p=>({...p,[key]:value}))} />)}</div>)}
        <Button size="sm" disabled={!blob || media.kind!=='video'} onClick={process}>{t("app.editor.motion.process")}</Button></fieldset>
        <p className="text-xs text-vx-fg-muted">{t("app.editor.motion.policy")}</p>
        {progress && <><progress aria-label={t("app.editor.motion.progress")} max={1} value={progress.done/progress.total} className="w-full" /><p role="status" className="text-xs">{progress.stage==='analyse'?t("app.editor.motion.analysing"):t("app.editor.motion.encoding")}</p><Button size="sm" onClick={()=>controller.current?.abort()}>{t("app.editor.motion.cancel")}</Button></>}
        {ready && <section aria-label={t("app.editor.motion.result")} className="space-y-2 text-xs"><p role="status">{t('app.editor.motion.ready', { cuts: t(pluralKey(t, locale, 'app.editor.motion.cuts', ready.report.sceneCuts), { count: number(ready.report.sceneCuts) }), percent: number(Math.round(ready.report.reliableMotionFraction*100)), lost: t(pluralKey(t, locale, 'app.editor.motion.lost', ready.report.trackingLostFrames), { count: number(ready.report.trackingLostFrames) }) })}</p>{ready.report.limits.map(limit=><p key={limit}>{limit}</p>)}<a href={ready.url} download={ready.file.name} className="underline">{t("app.editor.motion.download")}</a><Button size="sm" disabled={locked} onClick={insert}>{t("app.editor.motion.add")}</Button></section>}
    </div></details>;
}
