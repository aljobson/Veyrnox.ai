'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '../Button';
import {customFontFromFile} from '../../_lib/editorCustomFonts.mjs';
import {addCustomFont,removeCustomFont} from '../../_lib/editorOrganization.mjs';
export function CustomFontPanel({tl,registry,disabled,apply,onError,onLoaded,onBusy}){
    const [name,setName]=useState(''),[credit,setCredit]=useState(''),[usage,setUsage]=useState(''),[url,setUrl]=useState(''),[rights,setRights]=useState(false),[busy,setBusy]=useState(false);
    const current=useRef(tl),alive=useRef(true);
    useEffect(()=>{current.current=tl;},[tl]);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
    async function load(event,declared){
        const file=event.target.files[0];event.target.value='';if(!file)return;
        if(!declared&&!rights){onError('Confirm permission to use the font first.');return;}
        const snapshot=current.current;setBusy(true);onBusy?.(true);
        try{
            const {font,bytes}=await customFontFromFile(file,{name:declared?.name||name||file.name.replace(/\.[^.]+$/,''),rights:declared?.rights||{credit,usage,url}});
            if(declared&&(font.sha256!==declared.sha256||font.bytes!==declared.bytes))throw new Error('Choose the original font file with the matching SHA-256.');
            if(!alive.current||current.current!==snapshot)return;
            await registry.current.install(declared||font,bytes);
            if(!alive.current||current.current!==snapshot)return;
            if(!declared)apply(t=>t===snapshot?addCustomFont(t,font):{error:'The edit changed. Choose the font again.'});
            onLoaded();
        }catch(e){if(alive.current)onError(e.message||'This font could not be loaded.');}
        finally{if(alive.current)setBusy(false);onBusy?.(false);}
    }
    const field='w-full rounded border border-vx-border bg-vx-base p-2 text-xs';
    return <section aria-label="Custom fonts" className="space-y-2 rounded border border-vx-border p-2"><h3 className="text-xs font-bold">Custom fonts</h3><fieldset disabled={disabled||busy} className="space-y-2">
        {[['Font name',name,setName,80],['Font credit',credit,setCredit,120],['Font usage permission',usage,setUsage,240],['Font licence URL',url,setUrl,1000]].map(([label,value,set,max])=><label key={label} className="block text-xs">{label}<input aria-label={label} value={value} onChange={e=>set(e.target.value)} maxLength={max} className={field} /></label>)}
        <label className="flex gap-2 text-xs"><input type="checkbox" aria-label="I have permission to use this font" checked={rights} onChange={e=>setRights(e.target.checked)} />I have permission to use this font in my video.</label>
        <label className="block cursor-pointer text-xs text-vx-accent underline">Load a custom font<input aria-label="Load a custom font" type="file" accept=".ttf,.otf,.woff,.woff2" disabled={!rights||disabled||busy} className="sr-only" onChange={e=>void load(e)} /></label>
        <ul className="space-y-2">{(tl.fonts||[]).map(f=><li key={f.family} className="text-xs"><span>{f.name} · {registry.current?.has(f.family)?'Loaded':'Relink needed'}</span><p className="text-[10px] text-vx-fg-muted">{f.rights.credit} · {f.rights.usage}</p><div className="flex flex-wrap gap-2"><label className="cursor-pointer text-vx-accent underline">Relink font<input aria-label={`Relink font ${f.name}`} type="file" accept=".ttf,.otf,.woff,.woff2" className="sr-only" onChange={e=>void load(e,f)} /></label><Button size="sm" variant="ghost" aria-label={`Remove font ${f.name}`} onClick={()=>apply(t=>removeCustomFont(t,f.family))}>Remove</Button></div></li>)}</ul>
        <p className="text-[10px] text-vx-fg-muted">Up to eight fonts, 2 MiB each. Font files stay on this device. Saved projects retain source, rights and SHA-256; relink the same font after reopening on another browser. Export requires every used custom font.</p>
    </fieldset>{busy&&<p role="status" className="text-xs">Loading font…</p>}</section>;
}
