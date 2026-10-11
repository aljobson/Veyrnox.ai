'use client';
import {useState,useRef,useEffect} from 'react';
import {Button} from '../Button';
import {gatewayFetch} from '../../_lib/gateway';
import {getSession} from '../../../lib/authClient';
import {loadLibraryBlob} from '../../_lib/editorLibrary.mjs';
import {libraryMediaId} from '../../_lib/editorMedia.mjs';
import {AUDIO_STEMS} from '../../../../lib/audioStems.mjs';
export function AudioStemResult({job,disabled,onIngest,onError}) {
    const [stem,setStem]=useState('vocals'),[busy,setBusy]=useState(false),alive=useRef(true);
    useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
    async function receiveStem(download=false) {
        const owner=getSession()?.user?.id;if(!owner||busy)return;setBusy(true);
        try {
            if(download){
                const asset=await gatewayFetch(`/jobs/${encodeURIComponent(job.job_id)}/asset?stem=${stem}&download=1`);
                if(!alive.current||getSession()?.user?.id!==owner)return;
                if(typeof asset?.url!=='string'||!asset.url.startsWith('https://'))throw new Error('Invalid download link.');
                window.location.assign(asset.url);
            } else {
                const {blob}=await loadLibraryBlob(gatewayFetch,job.job_id,fetch,{stem});
                if(!alive.current||getSession()?.user?.id!==owner)return;
                await onIngest(blob,`Separated ${stem}`,`${libraryMediaId(job.job_id)}--${stem}`);
            }
        } catch(e) {if(alive.current&&getSession()?.user?.id===owner)onError(e.message||'Could not load this stem. Retry from your Library.');}
        finally {if(alive.current)setBusy(false);}
    }
    return <fieldset disabled={disabled||busy} className="space-y-2"><label className="block">Separated audio<select aria-label="Separated audio stem" value={stem} onChange={e=>setStem(e.target.value)} className="w-full rounded border border-vx-border bg-vx-base p-2">{AUDIO_STEMS.map(name=><option key={name}>{name}</option>)}</select></label><Button size="sm" onClick={()=>receiveStem()}>Add {stem} to edit</Button><Button size="sm" variant="ghost" onClick={()=>receiveStem(true)}>Download {stem}</Button><p>Each stem comes from this single separation job. Add several to independent audio tracks; omit vocals for an instrumental mix. Review leakage and timing.</p></fieldset>;
}
