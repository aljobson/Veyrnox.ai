'use client';
import { Button } from '../Button';
import { TRANSFORM_DEFAULTS, FILTER_DEFAULTS, TEXT_DEFAULTS, BLENDS, ANIMATIONS } from '../../_lib/editorSequenceValidation.mjs';
import { evaluatedTransform } from '../../_lib/editorSequenceRender.mjs';
const field = 'w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs';
export function NumberControl({ label, value, min, max, step = 0.01, onChange }) {
    return <label className="block text-xs">{label}<input aria-label={label} key={`${label}:${value}`} className={field} type="number" defaultValue={value} min={min} max={max} step={step} onBlur={e => { const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n) && n !== value) onChange(n); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>;
}
function SelectControl({ label, value, options, onChange }) { return <label className="block text-xs">{label}<select aria-label={label} className={field} value={value} onChange={e => onChange(e.target.value)}>{options.map(v => <option key={v} value={v}>{v === 'source-over' ? 'Normal' : v}</option>)}</select></label>; }
function ColorControl({ label, value, onChange }) { return <label className="flex items-center justify-between text-xs">{label}<input aria-label={label} type="color" value={value} onChange={e => onChange(e.target.value)} /></label>; }
export function VisualControls({ item, frame, onChange }) {
    const t = evaluatedTransform(item, Math.max(0, frame - item.start), false), f = { ...FILTER_DEFAULTS, ...item.filter }, crop = item.crop || { x: 0, y: 0, width: 1, height: 1 };
    const transform = (key, value) => onChange({ transform: { ...t, [key]: value } });
    return <>
        <details open><summary className="cursor-pointer text-xs font-bold">Transform</summary><div className="mt-2 grid grid-cols-2 gap-2">
            <NumberControl label="Position X (%)" value={t.x * 100} min={-200} max={300} onChange={n => transform('x', n / 100)} /><NumberControl label="Position Y (%)" value={t.y * 100} min={-200} max={300} onChange={n => transform('y', n / 100)} />
            <NumberControl label="Scale (%)" value={t.scale * 100} min={5} max={800} onChange={n => transform('scale', n / 100)} /><NumberControl label="Rotation (degrees)" value={t.rotation} min={-360} max={360} onChange={n => transform('rotation', n)} />
            <NumberControl label="Opacity (%)" value={t.opacity * 100} min={0} max={100} onChange={n => transform('opacity', n / 100)} /><SelectControl label="Picture fit" value={item.fit || 'contain'} options={['contain', 'cover']} onChange={fit => onChange({ fit })} />
            <Button size="sm" aria-pressed={t.flipX} onClick={() => transform('flipX', !t.flipX)}>Flip horizontal</Button><Button size="sm" aria-pressed={t.flipY} onClick={() => transform('flipY', !t.flipY)}>Flip vertical</Button>
        </div></details>
        <details><summary className="cursor-pointer text-xs font-bold">Crop and mask</summary><div className="mt-2 space-y-2">
            {['x', 'y', 'width', 'height'].map(key => <NumberControl key={key} label={`Crop ${key} (%)`} value={crop[key] * 100} min={key === 'width' || key === 'height' ? 5 : 0} max={100} onChange={n => onChange({ crop: { ...crop, [key]: n / 100 } })} />)}
            <SelectControl label="Mask" value={item.mask || 'none'} options={['none', 'circle', 'rounded', 'horizontal', 'vertical']} onChange={mask => onChange({ mask })} />
            <SelectControl label="Blend mode" value={item.blend || 'source-over'} options={BLENDS} onChange={blend => onChange({ blend })} />
        </div></details>
        <details><summary className="cursor-pointer text-xs font-bold">Colour</summary><div className="mt-2 space-y-2">
            {['brightness', 'contrast', 'saturate', 'hue', 'blur'].map(key => <NumberControl key={key} label={key === 'saturate' ? 'Saturation' : key[0].toUpperCase() + key.slice(1)} value={f[key]} min={key === 'hue' ? -180 : 0} max={key === 'hue' ? 180 : key === 'blur' ? 30 : 3} onChange={n => onChange({ filter: { ...f, [key]: n } })} />)}
            <Button size="sm" variant="ghost" onClick={() => onChange({ filter: { ...FILTER_DEFAULTS } })}>Reset colour</Button>
        </div></details>
        <AnimationControls item={item} onChange={onChange} />
        <details><summary className="cursor-pointer text-xs font-bold">Keyframes</summary><div className="mt-2 space-y-2">
            <Button size="sm" disabled={frame < item.start || frame >= item.start + item.len} onClick={() => { const at = frame - item.start, current = evaluatedTransform(item, at, false); const key = { frame: at, x: current.x, y: current.y, scale: current.scale, rotation: current.rotation, opacity: current.opacity, easing: 'linear' }; onChange({ keyframes: [...(item.keyframes || []).filter(k => k.frame !== at), key].sort((a, b) => a.frame - b.frame) }); }}>Add keyframe at playhead</Button>
            {(item.keyframes || []).map(k => <div key={k.frame} className="flex items-center gap-1 text-xs"><span>{(k.frame / 30).toFixed(2)}s</span><select aria-label={`Easing at frame ${k.frame}`} className={field} value={k.easing} onChange={e => onChange({ keyframes: item.keyframes.map(p => p.frame === k.frame ? { ...p, easing: e.target.value } : p) })}>{['linear', 'ease-in', 'ease-out', 'ease-in-out'].map(v => <option key={v}>{v}</option>)}</select><button type="button" aria-label={`Delete keyframe at frame ${k.frame}`} onClick={() => onChange({ keyframes: item.keyframes.filter(p => p.frame !== k.frame) })}>×</button></div>)}
        </div></details>
    </>;
}
export function AnimationControls({ item, onChange }) {
    const animation = item.animation || { in: 'none', out: 'none', duration: 15 };
    return <details><summary className="cursor-pointer text-xs font-bold">Animation</summary><div className="mt-2 space-y-2"><SelectControl label="Animation in" value={animation.in} options={ANIMATIONS} onChange={value => onChange({ animation: { ...animation, in: value } })} /><SelectControl label="Animation out" value={animation.out} options={ANIMATIONS} onChange={value => onChange({ animation: { ...animation, out: value } })} /><NumberControl label="Animation duration (seconds)" value={animation.duration / 30} min={1 / 30} max={4} onChange={n => onChange({ animation: { ...animation, duration: Math.round(n * 30) } })} /></div></details>;
}
export function SoundControls({ item, onChange, onRate, onExtract }) {
    const eq = item.eq || { low: 0, mid: 0, high: 0 };
    return <details><summary className="cursor-pointer text-xs font-bold">Audio and speed</summary><div className="mt-2 space-y-2">
        <NumberControl label="Volume (%)" value={item.volume * 100} min={0} max={200} onChange={n => onChange({ volume: n / 100 })} />
        <NumberControl label="Fade in (seconds)" value={(item.fadeIn || 0) / 30} min={0} max={item.len / 30} onChange={n => onChange({ fadeIn: Math.round(n * 30) })} /><NumberControl label="Fade out (seconds)" value={(item.fadeOut || 0) / 30} min={0} max={item.len / 30} onChange={n => onChange({ fadeOut: Math.round(n * 30) })} />
        <NumberControl label="Pan" value={item.pan || 0} min={-1} max={1} onChange={pan => onChange({ pan })} />
        {['low', 'mid', 'high'].map(key => <NumberControl key={key} label={`${key[0].toUpperCase()}${key.slice(1)} EQ (dB)`} value={eq[key]} min={-24} max={24} step={1} onChange={n => onChange({ eq: { ...eq, [key]: n } })} />)}
        {onRate && <><NumberControl label="Speed (×)" value={item.rate || 1} min={0.1} max={8} step={0.1} onChange={onRate} /><p className="text-[10px] text-vx-fg-muted">Speed changes sound pitch. Source time and output duration stay aligned. Overlapping sound is normalized when it would clip.</p></>}
        {onExtract && <Button size="sm" onClick={onExtract}>Extract audio</Button>}
    </div></details>;
}
export function TextControls({ item, onChange }) {
    const style = { ...TEXT_DEFAULTS, ...item.style }, change = (key, value) => onChange({ style: { ...style, [key]: value } });
    return <div className="space-y-2"><NumberControl label="Text size (%)" value={item.size} min={2} max={40} step={1} onChange={size => onChange({ size })} />
        <NumberControl label="Text X (%)" value={item.x * 100} min={0} max={100} onChange={n => onChange({ x: n / 100 })} /><NumberControl label="Text Y (%)" value={item.y * 100} min={0} max={100} onChange={n => onChange({ y: n / 100 })} />
        <SelectControl label="Font" value={style.font} options={['sans-serif', 'serif', 'monospace']} onChange={v => change('font', v)} /><SelectControl label="Weight" value={style.weight} options={['normal', 'bold']} onChange={v => change('weight', v)} /><SelectControl label="Text alignment" value={style.align} options={['left', 'center', 'right']} onChange={v => change('align', v)} />
        <ColorControl label="Text colour" value={style.color} onChange={v => change('color', v)} /><ColorControl label="Outline colour" value={style.stroke} onChange={v => change('stroke', v)} /><NumberControl label="Outline width" value={style.strokeWidth} min={0} max={12} onChange={v => change('strokeWidth', v)} />
        <ColorControl label="Text background" value={style.background} onChange={v => change('background', v)} /><NumberControl label="Text background opacity (%)" value={style.backgroundOpacity * 100} min={0} max={100} onChange={n => change('backgroundOpacity', n / 100)} /><AnimationControls item={item} onChange={onChange} />
    </div>;
}
