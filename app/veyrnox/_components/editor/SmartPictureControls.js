'use client';
import { Button } from '../Button';
import { NumberControl,ColorControl } from './EditorFields';
import { SMART_PICTURE } from '../../_lib/editorSmartPicture.mjs';
export function SmartPictureControls({item,onChange}) {
    const s={...SMART_PICTURE,...item.smartPicture},set=(k,v)=>onChange({smartPicture:{...s,[k]:v}});
    return <details><summary className="cursor-pointer text-xs font-bold">Local picture tools</summary><div className="mt-2 space-y-2">
        <NumberControl label="Image noise reduction" value={s.denoise} min={0} max={1} step={.05} onChange={v=>set('denoise',v)} />
        <label className="flex gap-2 text-xs"><input aria-label="Remove background by colour" type="checkbox" checked={s.keyEnabled} onChange={e=>set('keyEnabled',e.target.checked)} />Remove background by colour</label>
        {s.keyEnabled && <><ColorControl label="Background key colour" value={s.keyColor} onChange={v=>set('keyColor',v)} /><NumberControl label="Key colour tolerance" value={s.keyTolerance} min={0} max={1} step={.01} onChange={v=>set('keyTolerance',v)} /><NumberControl label="Key edge feather" value={s.keyFeather} min={.001} max={1} step={.01} onChange={v=>set('keyFeather',v)} /><NumberControl label="Key colour spill reduction" value={s.despill} min={0} max={1} step={.05} onChange={v=>set('despill',v)} /></>}
        <NumberControl label="Local relight exposure" value={s.light} min={-2} max={2} step={.1} onChange={v=>set('light',v)} />
        {!!s.light && <><NumberControl label="Light position X" value={s.lightX} min={0} max={1} step={.01} onChange={v=>set('lightX',v)} /><NumberControl label="Light position Y" value={s.lightY} min={0} max={1} step={.01} onChange={v=>set('lightY',v)} /><NumberControl label="Light radius" value={s.lightRadius} min={.05} max={2} step={.05} onChange={v=>set('lightRadius',v)} /></>}
        <Button size="sm" variant="ghost" onClick={()=>onChange({smartPicture:{...SMART_PICTURE}})}>Reset local picture tools</Button>
        <p className="text-xs text-vx-fg-muted">Colour keying works with plain backgrounds. Noise reduction preserves strong edges; relighting adds a soft exposure spot. These tools run locally.</p>
    </div></details>;
}
