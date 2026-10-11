'use client';
import { WordTimingControls } from './WordTimingControls';
import { TypographyControls } from './TypographyControls';
import { TEXT_FONTS } from '../../_lib/editorTextStyle.mjs';
import { AnimationControls,MotionControls,ParameterControls } from './AnimationControls';
import { evaluatedParameters } from '../../_lib/editorAnimation.mjs';
import { ColourControls } from './ColourControls';
import { MaskControls } from './MaskControls';
import { Button } from '../Button';
import { TRANSFORM_DEFAULTS, FILTER_DEFAULTS, TEXT_DEFAULTS, BLENDS } from '../../_lib/editorSequenceValidation.mjs';
import { evaluatedTransform } from '../../_lib/editorSequenceRender.mjs';
import { NumberControl, SelectControl, ColorControl } from './EditorFields';
export { NumberControl } from './EditorFields';
export function VisualControls({ item, frame, onChange }) {
    const t = evaluatedTransform(item, Math.max(0, frame - item.start), false), parameters=evaluatedParameters(item,frame-item.start), f=parameters.filter, crop = item.crop || { x: 0, y: 0, width: 1, height: 1 };
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
            <MaskControls item={item} frame={frame} onChange={onChange} />
            <SelectControl label="Blend mode" value={item.blend || 'source-over'} options={BLENDS} onChange={blend => onChange({ blend })} />
        </div></details>
        <details><summary className="cursor-pointer text-xs font-bold">Colour</summary><div className="mt-2 space-y-2">
            {['brightness', 'contrast', 'saturate', 'hue', 'blur'].map(key => <NumberControl key={key} label={key === 'saturate' ? 'Saturation' : key[0].toUpperCase() + key.slice(1)} value={f[key]} min={key === 'hue' ? -180 : 0} max={key === 'hue' ? 180 : key === 'blur' ? 30 : 3} onChange={n => onChange({ filter: { ...f, [key]: n } })} />)}
            <Button size="sm" variant="ghost" onClick={() => onChange({ filter: { ...FILTER_DEFAULTS } })}>Reset colour</Button>
            <ColourControls item={{...item,colourAdjustment:parameters.colour}} onChange={onChange} />
        </div></details>
        <AnimationControls item={item} onChange={onChange} />
        <MotionControls item={item} frame={frame} onChange={onChange} /><ParameterControls item={item} frame={frame} onChange={onChange} />
    </>;
}
export function SoundControls({ item, onChange, onRate, onExtract }) {
    const eq = item.eq || { low: 0, mid: 0, high: 0 };
    return <details><summary className="cursor-pointer text-xs font-bold">Audio and speed</summary><div className="mt-2 space-y-2">
        <NumberControl label="Volume (%)" value={item.volume * 100} min={0} max={200} onChange={n => onChange({ volume: n / 100 })} />
        <NumberControl label="Fade in (seconds)" value={(item.fadeIn || 0) / 30} min={0} max={item.len / 30} onChange={n => onChange({ fadeIn: Math.round(n * 30) })} /><NumberControl label="Fade out (seconds)" value={(item.fadeOut || 0) / 30} min={0} max={item.len / 30} onChange={n => onChange({ fadeOut: Math.round(n * 30) })} />
        <NumberControl label="Pan" value={item.pan || 0} min={-1} max={1} onChange={pan => onChange({ pan })} />
        {['low', 'mid', 'high'].map(key => <NumberControl key={key} label={`${key[0].toUpperCase()}${key.slice(1)} EQ (dB)`} value={eq[key]} min={-24} max={24} step={1} onChange={n => onChange({ eq: { ...eq, [key]: n } })} />)}
        {onRate && <><NumberControl label="Speed (×)" value={item.rate || 1} min={0.1} max={8} step={0.1} onChange={onRate} /><p className="text-[10px] text-vx-fg-muted">{item.preservePitch?'Speed preserves sound pitch.':'Speed changes sound pitch; enable pitch preservation in Voice and noise processing to keep it.'} Source time and output duration stay aligned. Overlapping sound is normalized when it would clip.</p></>}
        {onExtract && <Button size="sm" onClick={onExtract}>Extract audio</Button>}
    </div></details>;
}
export function TextControls({ item, frame, onChange,fonts=[] }) {
    const style = { ...TEXT_DEFAULTS, ...item.style }, change = (key, value) => onChange({ style: { ...style, [key]: value } });
    return <div className="space-y-2"><NumberControl label="Text size (%)" value={item.size} min={2} max={40} step={1} onChange={size => onChange({ size })} />
        <NumberControl label="Text X (%)" value={item.x * 100} min={0} max={100} onChange={n => onChange({ x: n / 100 })} /><NumberControl label="Text Y (%)" value={item.y * 100} min={0} max={100} onChange={n => onChange({ y: n / 100 })} />
        <label className="block text-xs">Font<select aria-label="Font" className="w-full rounded border border-vx-border bg-vx-base p-2 text-xs" value={style.font} onChange={e=>change('font',e.target.value)}>{TEXT_FONTS.map(f=><option key={f}>{f}</option>)}{fonts.map(f=><option key={f.family} value={f.family}>{f.name}</option>)}</select></label><SelectControl label="Weight" value={style.weight} options={['normal', 'bold']} onChange={v => change('weight', v)} /><SelectControl label="Text alignment" value={style.align} options={['left', 'center', 'right']} onChange={v => change('align', v)} />
        <ColorControl label="Text colour" value={style.color} onChange={v => change('color', v)} /><ColorControl label="Outline colour" value={style.stroke} onChange={v => change('stroke', v)} /><NumberControl label="Outline width" value={style.strokeWidth} min={0} max={12} onChange={v => change('strokeWidth', v)} />
        <ColorControl label="Text background" value={style.background} onChange={v => change('background', v)} /><NumberControl label="Text background opacity (%)" value={style.backgroundOpacity * 100} min={0} max={100} onChange={n => change('backgroundOpacity', n / 100)} /><WordTimingControls item={item} onChange={onChange} /><TypographyControls style={style} onChange={style=>onChange({style})} /><AnimationControls item={item} onChange={onChange} /><MotionControls item={item} frame={frame} onChange={onChange} />
    </div>;
}
