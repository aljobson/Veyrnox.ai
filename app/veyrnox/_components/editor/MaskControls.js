'use client';
import { Button } from '../Button';
import { NumberControl, SelectControl } from './EditorFields';
import { maskDefaults, evaluatedMask, maskKeyframe } from '../../_lib/editorMask.mjs';
export function MaskControls({ item, frame, onChange }) {
    const at = frame - item.start, settings = evaluatedMask(item, at), active = at >= 0 && at < item.len;
    function change(key, value) {
        const next = { ...settings, [key]: value };
        const maskKeyframes = item.maskKeyframes?.length && active && key !== 'inverted'
            ? [...item.maskKeyframes.filter(k => k.frame !== at), maskKeyframe({ ...item, maskSettings: next, maskKeyframes: [] }, at)].sort((a, b) => a.frame - b.frame) : item.maskKeyframes;
        onChange({ maskSettings: next, ...(maskKeyframes ? { maskKeyframes } : {}) });
    }
    return <div className="space-y-2">
        <SelectControl label="Mask" value={item.mask || 'none'} options={['none', 'circle', 'rounded', 'horizontal', 'vertical']} onChange={mask => onChange({ mask, maskSettings: maskDefaults(mask), maskKeyframes: [] })} />
        {item.mask && item.mask !== 'none' && <>
            <label className="block text-xs"><input aria-label="Invert mask" type="checkbox" checked={settings.inverted} onChange={e => change('inverted', e.target.checked)} /> Invert mask</label>
            <NumberControl label="Mask feather (%)" value={settings.feather * 100} min={0} max={25} onChange={n => change('feather', n / 100)} />
            <div className="grid grid-cols-2 gap-2">{['x','y','width','height'].map(key => <NumberControl key={key} label={`Mask ${key} (%)`} value={settings[key] * 100} min={key === 'x' || key === 'y' ? -100 : 5} max={200} onChange={n => change(key, n / 100)} />)}</div>
            <NumberControl label="Mask rotation (degrees)" value={settings.rotation} min={-360} max={360} onChange={n => change('rotation', n)} />
            <Button size="sm" disabled={!active || (item.maskKeyframes?.length >= 40 && !item.maskKeyframes.some(k => k.frame === at))} onClick={() => onChange({ maskKeyframes: [...(item.maskKeyframes || []).filter(k => k.frame !== at), maskKeyframe(item, at)].sort((a,b) => a.frame - b.frame) })}>Add mask keyframe at playhead</Button>
            {(item.maskKeyframes || []).map(k => <div key={k.frame} className="flex items-center gap-1 text-xs"><span>{(k.frame / 30).toFixed(2)}s</span><SelectControl label={`Mask easing at frame ${k.frame}`} value={k.easing} options={['linear','ease-in','ease-out','ease-in-out']} onChange={easing => onChange({ maskKeyframes: item.maskKeyframes.map(p => p.frame === k.frame ? { ...p, easing } : p) })} /><button type="button" aria-label={`Delete mask keyframe at frame ${k.frame}`} onClick={() => onChange({ maskKeyframes: item.maskKeyframes.filter(p => p.frame !== k.frame) })}>×</button></div>)}
            <Button size="sm" variant="ghost" onClick={() => onChange({ maskSettings: maskDefaults(item.mask), maskKeyframes: [] })}>Reset mask</Button>
        </>}
    </div>;
}
