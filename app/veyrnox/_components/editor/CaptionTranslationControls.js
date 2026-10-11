'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { translationAvailability, translateCaptionCues } from '../../_lib/editorTranslation.mjs';
const languages = [['en','English'],['es','Spanish'],['fr','French'],['de','German'],['it','Italian'],['pt','Portuguese'],['ja','Japanese'],['ko','Korean'],['zh','Chinese'],['hi','Hindi'],['ar','Arabic']];
export function CaptionTranslationControls({ tl, disabled, apply, onError, onBusy }) {
    const [source,setSource]=useState('en'),[target,setTarget]=useState('es'),[availability,setAvailability]=useState(null),[progress,setProgress]=useState(null);
    const controller=useRef(null),current=useRef(tl),alive=useRef(true);
    const pair=`${source}:${target}`,available=availability?.pair===pair?availability.value:'checking';
    useEffect(()=>{let active=true;translationAvailability(source,target).then(value=>active&&setAvailability({pair,value}));return()=>{active=false;};},[source,target,pair]);
    useLayoutEffect(()=>{current.current=tl;controller.current?.abort();},[tl,source,target]);
    useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();onBusy?.(false);};},[onBusy]);
    async function translate() {
        const snapshot=current.current,cues=snapshot.text.filter(c=>c.caption);
        if(cues.some(c=>snapshot.tracks.find(t=>t.id===c.trackId)?.locked)){onError('Unlock every caption track before translating.');return;}
        const job=new AbortController();controller.current=job;setProgress({stage:'model',fraction:0});onBusy?.(true);
        try {
            const translated=await translateCaptionCues(cues,{sourceLanguage:source,targetLanguage:target,signal:job.signal,onProgress:p=>alive.current&&setProgress(p)});
            if(job.signal.aborted || !alive.current || current.current!==snapshot)return;
            const byId=new Map(translated.map(c=>[c.id,c]));
            apply(t=>t!==snapshot?{error:'The captions changed. Retry translation.'}:{...t,text:t.text.map(c=>byId.get(c.id)||c)});
        } catch(e){if(e.name!=='AbortError' && alive.current)onError(e.message || 'Caption translation failed.');}
        finally{if(controller.current===job){controller.current=null;if(alive.current){setProgress(null);onBusy?.(false);}}}
    }
    const locked=disabled || !!progress,hasCaptions=tl.text.some(c=>c.caption);
    return <details><summary className="cursor-pointer text-xs font-bold">Translate captions</summary><div className="mt-2 space-y-2">
        {[[source,setSource,'Source language'],[target,setTarget,'Target language']].map(([value,set,label])=><label key={label} className="block text-xs">{label}<select aria-label={label} value={value} disabled={locked} onChange={e=>set(e.target.value)} className="w-full rounded border border-vx-border bg-vx-base p-2">{languages.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label>)}
        <p role="status" aria-label="Caption translation availability" className="text-xs text-vx-fg-muted">{available==='unavailable'?'On-device translation is unavailable for this browser or language pair.':available==='checking'?'Checking on-device translation…':available==='available'?'The on-device translation model is ready.':'The browser will download its translation model when you choose Translate.'} Caption text stays on this device. Review the translation before publishing.</p>
        <Button size="sm" disabled={locked || !hasCaptions || ['checking','unavailable'].includes(available) || source===target} onClick={translate}>Translate captions on device</Button>
        {progress && <><progress aria-label="Caption translation progress" max={1} value={progress.fraction} className="w-full" /><p role="status" className="text-xs">{progress.stage==='model'?'Preparing translation model':'Translating captions'}</p><Button size="sm" onClick={()=>controller.current?.abort()}>Cancel caption translation</Button></>}
    </div></details>;
}
