'use client';
import { useEffect,useRef } from 'react';
import { Button } from '../Button';
import { generationSlotKind,generationMimeTypes } from '../../../../lib/generationSourceSlots.mjs';
import { generationSourceLabel } from '../../_lib/editorGeneration.mjs';
function SourcePreview({source,label}) {
    const image=useRef(null);
    useEffect(()=>{if(!source.file)return;const url=URL.createObjectURL(source.file);if(image.current)image.current.src=url;return()=>URL.revokeObjectURL(url);},[source.file]);
    return source.file||source.previewUrl?<img ref={image} src={source.file?undefined:source.previewUrl} alt={`${label}: ${source.label}`} className="max-h-20 rounded border border-vx-border"/>:null;
}
export function GenerationSourceControls({model,sources,onFile,onLibrary,onClear}) {
    return Object.entries(model?.media||{}).map(([slot,spec])=>{
        const label=generationSourceLabel(model,slot),source=sources[slot],kind=generationSlotKind(slot);
        return <div key={slot} className="space-y-1 text-xs"><p>{label}{spec.required?' · required':' · optional'}{spec.maxSeconds?` · up to ${spec.maxSeconds}s`:''}</p>
            {source&&kind==='image'&&<SourcePreview source={source} label={label}/>}
            {source&&<p aria-label={`${label} selection`}>{source.label} · {source.file?'Device':'Library'}</p>}
            <label className="block">Choose {label.toLowerCase()} from device<input aria-label={`Choose ${label} from device`} type="file" accept={generationMimeTypes(kind).join(',')} className="block w-full text-xs" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)onFile(slot,file);}}/></label>
            <Button size="sm" variant="ghost" aria-label={`Choose ${label} from Library`} onClick={()=>onLibrary(slot)}>Choose Library {label.toLowerCase()}</Button>
            {source&&<Button size="sm" variant="ghost" onClick={()=>onClear(slot)}>Clear {label.toLowerCase()}</Button>}
        </div>;
    });
}
