'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { translationAvailability, translateCaptionCues } from '../../_lib/editorTranslation.mjs';
const languages = [['en','English'],['es','Spanish'],['fr','French'],['de','German'],['it','Italian'],['pt','Portuguese'],['ja','Japanese'],['ko','Korean'],['zh','Chinese'],['hi','Hindi'],['ar','Arabic']];
export function CaptionTranslationControls({ tl, disabled, apply, onError, onBusy }) {
  const { t, locale } = useI18n();
    const languageName = (code, name) => locale === 'en' ? name : new Intl.DisplayNames([localeTag(locale)], {type:'language'}).of(code);
    const [source,setSource]=useState('en'),[target,setTarget]=useState('es'),[availability,setAvailability]=useState(null),[progress,setProgress]=useState(null);
    const controller=useRef(null),current=useRef(tl),alive=useRef(true);
    const pair=`${source}:${target}`,available=availability?.pair===pair?availability.value:'checking',busy=!!progress;
    useEffect(()=>{if(busy)return;let active=true;translationAvailability(source,target).then(value=>active&&setAvailability({pair,value}));return()=>{active=false;};},[source,target,pair,busy]);
    useLayoutEffect(()=>{current.current=tl;controller.current?.abort();},[tl,source,target]);
    useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();onBusy?.(false);};},[onBusy]);
    async function translate() {
        const snapshot=current.current,cues=snapshot.text.filter(c=>c.caption);
        if(cues.some(c=>snapshot.tracks.find(track=>track.id===c.trackId)?.locked)){onError(t("app.editor.captionTranslation.unlock"));return;}
        const job=new AbortController();controller.current=job;setProgress({stage:'model',fraction:0});onBusy?.(true);
        try {
            const translated=await translateCaptionCues(cues,{sourceLanguage:source,targetLanguage:target,signal:job.signal,onProgress:p=>alive.current&&setProgress(p)});
            if(job.signal.aborted || !alive.current || current.current!==snapshot)return;
            const byId=new Map(translated.map(c=>[c.id,c]));
            apply(timeline=>timeline!==snapshot?{error:t("app.editor.captionTranslation.changed")}:{...timeline,text:timeline.text.map(c=>byId.get(c.id)||c)});
        } catch(e){if(e.name!=='AbortError' && alive.current)onError(e.message || t("app.editor.captionTranslation.failed"));}
        finally{if(controller.current===job){controller.current=null;if(alive.current){setProgress(null);onBusy?.(false);}}}
    }
    const locked=disabled || !!progress,hasCaptions=tl.text.some(c=>c.caption);
    return <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.captionTranslation.title")}</summary><div className="mt-2 space-y-2">
        {[[source,setSource,t("app.editor.captionTranslation.source")],[target,setTarget,t("app.editor.captionTranslation.target")]].map(([value,set,label])=><label key={value} className="block text-xs">{label}<select aria-label={label} value={value} disabled={locked} onChange={e=>set(e.target.value)} className="w-full rounded border border-vx-border bg-vx-base p-2">{languages.map(([code,name])=><option key={code} value={code}>{languageName(code,name)}</option>)}</select></label>)}
        <p role="status" aria-label={t("app.editor.captionTranslation.availability")} className="text-xs text-vx-fg-muted">{available==='unavailable'?t("app.editor.captionTranslation.unavailable"):available==='checking'?t("app.editor.captionTranslation.checking"):available==='available'?t("app.editor.captionTranslation.ready"):t("app.editor.captionTranslation.download")}{t("app.editor.captionTranslation.privacy")}</p>
        <Button size="sm" disabled={locked || !hasCaptions || ['checking','unavailable'].includes(available) || source===target} onClick={translate}>{t("app.editor.captionTranslation.translate")}</Button>
        {progress && <><progress aria-label={t("app.editor.captionTranslation.progress")} max={1} value={progress.fraction} className="w-full" /><p role="status" className="text-xs">{progress.stage==='model'?t("app.editor.captionTranslation.preparing"):t("app.editor.captionTranslation.translating")}</p><Button size="sm" onClick={()=>controller.current?.abort()}>{t("app.editor.captionTranslation.cancel")}</Button></>}
    </div></details>;
}
