'use client';
import { TEXT_EXTRAS } from '../../_lib/editorTextStyle.mjs';
import { NumberControl,ColorControl } from './EditorFields';
export function TypographyControls({style,onChange}) {
    const s={...TEXT_EXTRAS,...style},set=(key,value)=>onChange({...s,[key]:value});
    return <details><summary className="cursor-pointer text-xs font-bold">Typography and shadow</summary><div className="mt-2 space-y-2">
        {['italic','underline'].map(key=><label key={key} className="flex items-center gap-2 text-xs"><input aria-label={key==='italic'?'Italic text':'Underline text'} type="checkbox" checked={s[key]} onChange={e=>set(key,e.target.checked)} />{key==='italic'?'Italic':'Underline'}</label>)}
        <NumberControl label="Letter spacing (pixels at 720p)" value={s.letterSpacing} min={-10} max={30} onChange={n=>set('letterSpacing',n)} /><NumberControl label="Text line height" value={s.lineHeight} min={.8} max={3} onChange={n=>set('lineHeight',n)} />
        <ColorControl label="Text shadow colour" value={s.shadowColor} onChange={v=>set('shadowColor',v)} /><NumberControl label="Text shadow opacity (%)" value={s.shadowOpacity*100} min={0} max={100} onChange={n=>set('shadowOpacity',n/100)} />
        <NumberControl label="Text shadow blur" value={s.shadowBlur} min={0} max={30} onChange={n=>set('shadowBlur',n)} />
        <NumberControl label="Text shadow X" value={s.shadowX} min={-50} max={50} onChange={n=>set('shadowX',n)} /><NumberControl label="Text shadow Y" value={s.shadowY} min={-50} max={50} onChange={n=>set('shadowY',n)} />
        <p className="text-xs text-vx-fg-muted">System fonts use the fonts installed on this computer, with a matching generic fallback.</p>
    </div></details>;
}
