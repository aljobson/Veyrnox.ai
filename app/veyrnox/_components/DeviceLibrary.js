'use client';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {getStoredUserId,onSessionChange} from '../../lib/authClient.js';
import {listDeviceLibrary,saveDeviceLibrary} from '../_lib/deviceLibrary.mjs';
import {checkLocalFile,checkProbe,probeMedia} from '../_lib/editorMedia.mjs';
const guest=()=> 'guest',actorNow=()=>getStoredUserId() || 'guest';
export function DeviceLibrary({visible=true,kind='all'}) {
    const actor=useSyncExternalStore(onSessionChange,actorNow,guest);
    return visible?<DeviceFiles key={actor} actor={actor} kind={kind}/>:null;
}
function DeviceFiles({actor,kind}) {
    const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
    const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
    const current=()=>alive.current && actor===actorNow();
    useEffect(()=>{let active=true;listDeviceLibrary(actor).then(items=>active && setRows(items)).catch(e=>active && setError(e.message));return()=>{active=false;};},[actor,revision]);
    async function add(event){const files=[...event.target.files];event.target.value='';setBusy(true);setError('');
        for(const file of files){try{const problem=checkLocalFile(file).error;if(problem)throw new Error(problem);const probe=await probeMedia(file),bad=checkProbe(probe);if(bad)throw new Error(bad);await saveDeviceLibrary(actor,file,probe,{isCurrent:current});}catch(e){if(current())setError(e.message);}}
        if(current()){setRevision(n=>n+1);setBusy(false);}
    }
    const shown=rows.filter(row=>kind==='all' || row.kind===kind);
    return <section aria-label="Device Library" className="mx-auto max-w-[1400px] space-y-3 px-4 py-6 sm:px-8"><h2 className="text-xl font-semibold">On this device</h2><p className="text-sm text-vx-fg-muted">Original videos, images and audio stay in this browser. They are available here and in the editor after a reload. They are not uploaded or available on another device; keep your originals.</p>
        <label className="inline-block cursor-pointer rounded-lg border border-vx-border px-4 py-2 text-sm">Add files from device<input aria-label="Add files to Device Library" className="sr-only" type="file" multiple accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/mp4,image/png,image/jpeg,image/webp" disabled={busy} onChange={add}/></label>
        {busy && <p role="status">Saving original files on this device…</p>}{error && <p role="alert">{error}</p>}
        {shown.length?<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{shown.map(row=><li key={row.id} className="rounded-lg border border-vx-border p-3"><p className="break-words font-semibold">{row.label}</p><p className="text-xs text-vx-fg-muted">{row.kind} · {(row.size/1048576).toFixed(2)} MiB · This device</p><a aria-label={`Add ${row.label} to video editor`} className="text-sm text-vx-accent underline" href={`/app/editor?device=${encodeURIComponent(row.id)}`}>Add to video editor</a></li>)}</ul>:<p className="text-sm text-vx-fg-muted">No matching originals saved on this device yet.</p>}
    </section>;
}
