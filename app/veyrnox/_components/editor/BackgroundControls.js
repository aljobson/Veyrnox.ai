'use client';
import { Button } from '../Button';
import { BACKGROUND_DEFAULTS } from '../../_lib/editorBackground.mjs';
import { NumberControl,SelectControl,ColorControl } from './EditorFields';
export function BackgroundControls({item,media,onChange,onAll}) {
    const b={...BACKGROUND_DEFAULTS,...item.background},images=Object.values(media).filter(m=>['image','graphic'].includes(m.kind));
    const change=(key,value)=>onChange({background:{...b,[key]:value,...(key==='type'?{mediaId:value==='image'?(images[0]?.id || ''):''}:{})}});
    return <details><summary className="cursor-pointer text-xs font-bold">Background</summary><div className="mt-2 space-y-2">
        <SelectControl label="Clip background" value={b.type} options={['none','solid','blur',...(images.length?['image']:[])]} onChange={v=>change('type',v)} />
        {b.type!=='none' && <ColorControl label="Background colour" value={b.color} onChange={v=>change('color',v)} />}
        {b.type==='blur' && <NumberControl label="Background blur" value={b.blur} min={0} max={60} step={1} onChange={v=>change('blur',v)} />}
        {b.type==='image' && <label className="block text-xs">Background image<select aria-label="Background image" className="w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs" value={b.mediaId} onChange={e=>change('mediaId',e.target.value)}>{images.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
        {!images.length && <p className="text-xs text-vx-fg-muted">Import an image or add an element to use it as a background.</p>}
        <Button size="sm" onClick={()=>onAll(b)}>Apply background to all video clips</Button>
        <p className="text-xs text-vx-fg-muted">Backdrops fill the canvas behind this clip. Reduce its scale or change the canvas shape to expose the backdrop.</p>
    </div></details>;
}
