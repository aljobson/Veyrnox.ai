'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { pluralKey, tOr } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
const REGIONS = ['face', 'body', 'both'];
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Button} from '../Button';
import {NumberControl} from './EditorFields';
import {processVisionVideo} from '../../_lib/editorVisionVideo.mjs';
const tools = ['replace-background', 'remove-background', 'skin-retouch', 'person-glow', 'person-reframe', 'person-reshape', 'person-light'];
export function PersonProcessingControls({media,blob,timeline,disabled,onIngest,onBusy,onError}){
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : value.toLocaleString(localeTag(locale));
  const detectedFrames = count => t(pluralKey(t, locale, 'app.editor.person.detected', count), { count: number(count) });
  const reshapedFrames = count => t(pluralKey(t, locale, 'app.editor.person.reshaped', count), { count: number(count) });
  const missingFrames = count => t(pluralKey(t, locale, 'app.editor.person.missing', count), { count: number(count) });
    const [tool,setTool]=useState('replace-background'),[colour,setColour]=useState('#32d6c5'),[strength,setStrength]=useState(.5),[region,setRegion]=useState('both'),[light,setLight]=useState(0),[aspect,setAspect]=useState(9/16),[lightColour,setLightColour]=useState('#ffffff'),[lightAngle,setLightAngle]=useState(-45),[lightExposure,setLightExposure]=useState(.7),[lightAmbient,setLightAmbient]=useState(0),[widthAmount,setWidthAmount]=useState(-.15),[heightAmount,setHeightAmount]=useState(0),[reshapeRegion,setReshapeRegion]=useState('face'),[progress,setProgress]=useState(null),[result,setResult]=useState(null),[inserting,setInserting]=useState(false);
    const controller=useRef(null),alive=useRef(true),current=useRef(timeline),source=useRef(blob);
    useLayoutEffect(()=>{current.current=timeline;source.current=blob;controller.current?.abort();},[timeline,blob]);
    useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();onBusy(false);};},[onBusy]);
    useEffect(()=>()=>{if(result)URL.revokeObjectURL(result.url);},[result]);
    const ready=result?.snapshot===timeline&&result?.original===blob?result:null;
    async function process(){
        const snapshot=current.current,original=source.current,job=new AbortController();controller.current=job;onBusy(true);setResult(null);setProgress({stage:'model',done:0,total:1});
        try{const output=await processVisionVideo(original,{tool,name:media.name,colour:[1,3,5].map(i=>parseInt((tool==='person-light'?lightColour:colour).slice(i,i+2),16)),strength:['remove-background','replace-background'].includes(tool)?1:strength,region:tool==='person-reshape'?reshapeRegion:region,widthAmount,heightAmount,lightAngle,lightExposure,lightAmbient,light,aspect,height:720,signal:job.signal,onProgress:p=>alive.current&&!job.signal.aborted&&setProgress(p)});if(!alive.current||job.signal.aborted||current.current!==snapshot||source.current!==original)return;setResult({...output,tool,url:URL.createObjectURL(output.blob),snapshot,original});}
        catch(e){if(e.name!=='AbortError'&&alive.current)onError(e.message||t("app.editor.person.failed"));}
        finally{if(controller.current===job){controller.current=null;if(alive.current){setProgress(null);onBusy(false);}}}
    }
    async function insert(){
        if(!ready){onError(t("app.editor.person.changed"));return;}setInserting(true);onBusy(true);
        try{await onIngest(ready.file,ready.file.name,undefined,undefined,{...(media.attribution?{attribution:media.attribution}:{}),folder:t("app.editor.person.folder")});if(alive.current)setResult(null);}catch(e){if(alive.current)onError(e.message);}finally{if(alive.current){setInserting(false);onBusy(false);}}
    }
    const locked=disabled||!!progress||inserting;
    return <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.person.title")}</summary><div className="mt-2 space-y-2"><fieldset disabled={locked} className="space-y-2">
        <label className="block text-xs">{t("app.editor.person.operation")}<select aria-label={t("app.editor.person.operation")} value={tool} onChange={e=>setTool(e.target.value)} className="w-full rounded border border-vx-border bg-vx-base p-2 text-xs">{tools.map(id=><option key={id} value={id}>{t(`app.editor.person.tool.${id}`)}</option>)}</select></label>
        {['replace-background','person-glow','person-light'].includes(tool)&&<label className="flex justify-between text-xs">{tool==='person-light'?t("app.editor.person.lightColour"):t("app.editor.person.processedColour")}<input aria-label={tool==='person-light'?t("app.editor.person.personLightColour"):t("app.editor.person.personColour")} type="color" value={tool==='person-light'?lightColour:colour} onChange={e=>(tool==='person-light'?setLightColour:setColour)(e.target.value)} /></label>}
        {['skin-retouch','person-glow'].includes(tool)&&<NumberControl label={t("app.editor.person.strength")} value={strength} min={0} max={1} step={.05} onChange={setStrength} />}
        {tool==='skin-retouch'&&<><label className="block text-xs">{t("app.editor.person.skinRegion")}<select aria-label={t("app.editor.person.skinRegion")} value={region} onChange={e=>setRegion(e.target.value)} className="w-full rounded bg-vx-base p-2 text-xs">{REGIONS.map(v=><option key={v} value={v}>{t(`app.editor.person.region.${v}`)}</option>)}</select></label><NumberControl label={t("app.editor.person.skinLighting")} value={light} min={-.5} max={.5} step={.05} onChange={setLight} /></>}
        {tool==='person-light'&&<><NumberControl label={t("app.editor.person.direction")} value={lightAngle} min={-180} max={180} step={15} onChange={setLightAngle} /><NumberControl label={t("app.editor.person.intensity")} value={lightExposure} min={0} max={1.5} step={.1} onChange={setLightExposure} /><NumberControl label={t("app.editor.person.ambient")} value={lightAmbient} min={-.5} max={.5} step={.1} onChange={setLightAmbient} /><p className="text-xs text-vx-fg-muted">{t("app.editor.person.lightHelp")}</p></>}
        {tool==='person-reshape'&&<><label className="block text-xs">{t("app.editor.person.reshapeRegion")}<select aria-label={t("app.editor.person.reshapeRegion")} value={reshapeRegion} onChange={e=>setReshapeRegion(e.target.value)} className="w-full rounded bg-vx-base p-2 text-xs"><option value="face">{t("app.editor.person.face")}</option><option value="body">{t("app.editor.person.body")}</option></select></label><NumberControl label={t("app.editor.person.width")} value={widthAmount*100} min={-25} max={25} step={1} onChange={n=>setWidthAmount(n/100)} /><NumberControl label={t("app.editor.person.height")} value={heightAmount*100} min={-25} max={25} step={1} onChange={n=>setHeightAmount(n/100)} /><p className="text-xs text-vx-fg-muted">{t("app.editor.person.reshapeHelp")}</p></>}
        {tool==='person-reframe'&&<label className="block text-xs">{t("app.editor.person.shape")}<select aria-label={t("app.editor.person.shape")} value={aspect} onChange={e=>setAspect(Number(e.target.value))} className="w-full rounded bg-vx-base p-2 text-xs"><option value={9/16}>{t("app.editor.person.portrait")}</option><option value={1}>{t("app.editor.person.square")}</option><option value={16/9}>{t("app.editor.person.landscape")}</option></select></label>}
        <Button size="sm" disabled={!blob} onClick={process}>{t("app.editor.person.process")}</Button></fieldset>
        <p className="text-xs text-vx-fg-muted">{t("app.editor.person.policy")}</p>
        {progress&&<><progress aria-label={t("app.editor.person.progress")} max={1} value={progress.done/progress.total} className="w-full" /><p role="status" className="text-xs">{progress.stage==='model'?t("app.editor.person.preparing"):progress.stage==='analyse'?t("app.editor.person.segmenting"):t("app.editor.person.encoding")}</p><Button size="sm" onClick={()=>controller.current?.abort()}>{t("app.editor.person.cancel")}</Button></>}
        {ready&&<section aria-label={t("app.editor.person.result")} className="space-y-2 text-xs"><p role="status">{t('app.editor.person.ready', { operation: ready.tool === 'person-reshape' ? tOr(t, `app.editor.person.reshape.${ready.report.region}`, t('app.editor.person.tool.person-reshape')) : tOr(t, `app.editor.person.tool.${ready.tool}`, t('app.editor.person.title')), detected: detectedFrames(ready.report.personFrames), reshaped: ready.tool === 'person-reshape' ? reshapedFrames(ready.report.regionFrames) : '', missing: missingFrames(ready.report.noPersonFrames) })}</p>{ready.report.limits.map(v=><p key={v}>{v}</p>)}<a href={ready.url} download={ready.file.name} className="underline">{t("app.editor.person.download")}</a><Button size="sm" disabled={locked} onClick={insert}>{t("app.editor.person.add")}</Button></section>}
    </div></details>;
}
