'use client';
import { useI18n } from '../../../../components/I18nProvider';
import {useEffect,useRef,useState} from 'react';
import {Button} from '../Button';
import {customFontFromFile} from '../../_lib/editorCustomFonts.mjs';
import {addCustomFont,removeCustomFont} from '../../_lib/editorOrganization.mjs';
export function CustomFontPanel({tl,registry,disabled,apply,onError,onLoaded,onBusy}){
  const { t } = useI18n();
    const [name,setName]=useState(''),[credit,setCredit]=useState(''),[usage,setUsage]=useState(''),[url,setUrl]=useState(''),[rights,setRights]=useState(false),[busy,setBusy]=useState(false);
    const current=useRef(tl),alive=useRef(true);
    useEffect(()=>{current.current=tl;},[tl]);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
    async function load(event,declared){
        const file=event.target.files[0];event.target.value='';if(!file)return;
        if(!declared&&!rights){onError(t("app.editor.font.permissionFirst"));return;}
        const snapshot=current.current;setBusy(true);onBusy?.(true);
        try{
            const {font,bytes}=await customFontFromFile(file,{name:declared?.name||name||file.name.replace(/\.[^.]+$/,''),rights:declared?.rights||{credit,usage,url}});
            if(declared&&(font.sha256!==declared.sha256||font.bytes!==declared.bytes))throw new Error(t("app.editor.font.original"));
            if(!alive.current||current.current!==snapshot)return;
            await registry.current.install(declared||font,bytes);
            if(!alive.current||current.current!==snapshot)return;
            if(!declared)apply(timeline=>timeline===snapshot?addCustomFont(timeline,font):{error:t("app.editor.font.changed")});
            onLoaded();
        }catch(e){if(alive.current)onError(e.message||t("app.editor.font.failed"));}
        finally{if(alive.current)setBusy(false);onBusy?.(false);}
    }
    const field='w-full rounded border border-vx-border bg-vx-base p-2 text-xs';
    return <section aria-label={t("app.editor.font.title")} className="space-y-2 rounded border border-vx-border p-2"><h3 className="text-xs font-bold">{t("app.editor.font.title")}</h3><fieldset disabled={disabled||busy} className="space-y-2">
        {[[t("app.editor.font.name"),name,setName,80],[t("app.editor.font.credit"),credit,setCredit,120],[t("app.editor.font.usage"),usage,setUsage,240],[t("app.editor.font.licence"),url,setUrl,1000]].map(([label,value,set,max])=><label key={label} className="block text-xs">{label}<input aria-label={label} value={value} onChange={e=>set(e.target.value)} maxLength={max} className={field} /></label>)}
        <label className="flex gap-2 text-xs"><input type="checkbox" aria-label={t("app.editor.font.rightsLabel")} checked={rights} onChange={e=>setRights(e.target.checked)} />{t("app.editor.font.rights")}</label>
        <label className="block cursor-pointer text-xs text-vx-accent underline">{t("app.editor.font.load")}<input aria-label={t("app.editor.font.load")} type="file" accept=".ttf,.otf,.woff,.woff2" disabled={!rights||disabled||busy} className="sr-only" onChange={e=>void load(e)} /></label>
        <ul className="space-y-2">{(tl.fonts||[]).map(f=><li key={f.family} className="text-xs"><span>{f.name} · {registry.current?.has(f.family)?t("app.editor.media.loaded"):t("app.editor.media.relinkNeeded")}</span><p className="text-[10px] text-vx-fg-muted">{f.rights.credit} · {f.rights.usage}</p><div className="flex flex-wrap gap-2"><label className="cursor-pointer text-vx-accent underline">{t("app.editor.font.relink")}<input aria-label={t('app.editor.font.relinkLabel', {name: f.name})} type="file" accept=".ttf,.otf,.woff,.woff2" className="sr-only" onChange={e=>void load(e,f)} /></label><Button size="sm" variant="ghost" aria-label={t('app.editor.font.removeLabel', {name: f.name})} onClick={()=>apply(timeline=>removeCustomFont(timeline,f.family))}>{t("app.publish.smartlink.remove")}</Button></div></li>)}</ul>
        <p className="text-[10px] text-vx-fg-muted">{t("app.editor.font.note")}</p>
    </fieldset>{busy&&<p role="status" className="text-xs">{t("app.editor.font.loading")}</p>}</section>;
}
