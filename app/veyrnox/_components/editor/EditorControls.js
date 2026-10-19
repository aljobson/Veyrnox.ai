'use client';
import { useI18n } from '../../../../components/I18nProvider';
const CROP_KEYS = ['x', 'y', 'width', 'height'];
const FILTER_KEYS = ['brightness', 'contrast', 'saturate', 'hue', 'blur'];
const EQ_KEYS = ['low', 'mid', 'high'];
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
  const { t } = useI18n();
    const evaluated = evaluatedTransform(item, Math.max(0, frame - item.start), false), parameters=evaluatedParameters(item,frame-item.start), f=parameters.filter, crop = item.crop || { x: 0, y: 0, width: 1, height: 1 };
    const transform = (key, value) => onChange({ transform: { ...evaluated, [key]: value } });
    return <>
        <details open><summary className="cursor-pointer text-xs font-bold">{t("app.editor.controls.transform")}</summary><div className="mt-2 grid grid-cols-2 gap-2">
            <NumberControl label={t("app.editor.controls.x")} value={evaluated.x * 100} min={-200} max={300} onChange={n => transform('x', n / 100)} /><NumberControl label={t("app.editor.controls.y")} value={evaluated.y * 100} min={-200} max={300} onChange={n => transform('y', n / 100)} />
            <NumberControl label={t("app.editor.controls.scale")} value={evaluated.scale * 100} min={5} max={800} onChange={n => transform('scale', n / 100)} /><NumberControl label={t("app.editor.controls.rotation")} value={evaluated.rotation} min={-360} max={360} onChange={n => transform('rotation', n)} />
            <NumberControl label={t("app.editor.controls.opacity")} value={evaluated.opacity * 100} min={0} max={100} onChange={n => transform('opacity', n / 100)} /><SelectControl label={t("app.editor.controls.fit")} value={item.fit || 'contain'} options={['contain', 'cover']} onChange={fit => onChange({ fit })} />
            <Button size="sm" aria-pressed={evaluated.flipX} onClick={() => transform('flipX', !evaluated.flipX)}>{t("app.editor.controls.flipX")}</Button><Button size="sm" aria-pressed={evaluated.flipY} onClick={() => transform('flipY', !evaluated.flipY)}>{t("app.editor.controls.flipY")}</Button>
        </div></details>
        <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.controls.cropMask")}</summary><div className="mt-2 space-y-2">
            {CROP_KEYS.map(key => <NumberControl key={key} label={t(`app.editor.controls.crop.${key}`)} value={crop[key] * 100} min={key === 'width' || key === 'height' ? 5 : 0} max={100} onChange={n => onChange({ crop: { ...crop, [key]: n / 100 } })} />)}
            <MaskControls item={item} frame={frame} onChange={onChange} />
            <SelectControl label={t("app.editor.controls.blend")} value={item.blend || 'source-over'} options={BLENDS} onChange={blend => onChange({ blend })} />
        </div></details>
        <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.controls.colour")}</summary><div className="mt-2 space-y-2">
            {FILTER_KEYS.map(key => <NumberControl key={key} label={t(`app.editor.controls.filter.${key}`)} value={f[key]} min={key === 'hue' ? -180 : 0} max={key === 'hue' ? 180 : key === 'blur' ? 30 : 3} onChange={n => onChange({ filter: { ...f, [key]: n } })} />)}
            <Button size="sm" variant="ghost" onClick={() => onChange({ filter: { ...FILTER_DEFAULTS } })}>{t("app.editor.controls.resetColour")}</Button>
            <ColourControls item={{...item,colourAdjustment:parameters.colour}} onChange={onChange} />
        </div></details>
        <AnimationControls item={item} onChange={onChange} />
        <MotionControls item={item} frame={frame} onChange={onChange} /><ParameterControls item={item} frame={frame} onChange={onChange} />
    </>;
}
export function SoundControls({ item, onChange, onRate, onExtract }) {
  const { t } = useI18n();
    const eq = item.eq || { low: 0, mid: 0, high: 0 };
    return <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.controls.audioSpeed")}</summary><div className="mt-2 space-y-2">
        <NumberControl label={t("app.editor.controls.volume")} value={item.volume * 100} min={0} max={200} onChange={n => onChange({ volume: n / 100 })} />
        <NumberControl label={t("app.editor.controls.fadeIn")} value={(item.fadeIn || 0) / 30} min={0} max={item.len / 30} onChange={n => onChange({ fadeIn: Math.round(n * 30) })} /><NumberControl label={t("app.editor.controls.fadeOut")} value={(item.fadeOut || 0) / 30} min={0} max={item.len / 30} onChange={n => onChange({ fadeOut: Math.round(n * 30) })} />
        <NumberControl label={t("app.editor.controls.pan")} value={item.pan || 0} min={-1} max={1} onChange={pan => onChange({ pan })} />
        {EQ_KEYS.map(key => <NumberControl key={key} label={t(`app.editor.controls.eq.${key}`)} value={eq[key]} min={-24} max={24} step={1} onChange={n => onChange({ eq: { ...eq, [key]: n } })} />)}
        {onRate && <><NumberControl label={t("app.editor.controls.speed")} value={item.rate || 1} min={0.1} max={8} step={0.1} onChange={onRate} /><p className="text-[10px] text-vx-fg-muted">{item.preservePitch?t("app.editor.controls.pitchKept"):t("app.editor.controls.pitchChanges")}{' '}{t("app.editor.controls.durationHelp")}</p></>}
        {onExtract && <Button size="sm" onClick={onExtract}>{t("app.editor.controls.extract")}</Button>}
    </div></details>;
}
export function TextControls({ item, frame, onChange,fonts=[] }) {
  const { t } = useI18n();
    const style = { ...TEXT_DEFAULTS, ...item.style }, change = (key, value) => onChange({ style: { ...style, [key]: value } });
    return <div className="space-y-2"><NumberControl label={t("app.editor.controls.textSize")} value={item.size} min={2} max={40} step={1} onChange={size => onChange({ size })} />
        <NumberControl label={t("app.editor.controls.textX")} value={item.x * 100} min={0} max={100} onChange={n => onChange({ x: n / 100 })} /><NumberControl label={t("app.editor.controls.textY")} value={item.y * 100} min={0} max={100} onChange={n => onChange({ y: n / 100 })} />
        <label className="block text-xs">{t("app.editor.controls.font")}<select aria-label={t("app.editor.controls.font")} className="w-full rounded border border-vx-border bg-vx-base p-2 text-xs" value={style.font} onChange={e=>change('font',e.target.value)}>{TEXT_FONTS.map(f=><option key={f}>{f}</option>)}{fonts.map(f=><option key={f.family} value={f.family}>{f.name}</option>)}</select></label><SelectControl label={t("app.editor.controls.weight")} value={style.weight} options={['normal', 'bold']} onChange={v => change('weight', v)} /><SelectControl label={t("app.editor.controls.align")} value={style.align} options={['left', 'center', 'right']} onChange={v => change('align', v)} />
        <ColorControl label={t("app.editor.controls.textColour")} value={style.color} onChange={v => change('color', v)} /><ColorControl label={t("app.editor.controls.outlineColour")} value={style.stroke} onChange={v => change('stroke', v)} /><NumberControl label={t("app.editor.controls.outlineWidth")} value={style.strokeWidth} min={0} max={12} onChange={v => change('strokeWidth', v)} />
        <ColorControl label={t("app.editor.controls.textBackground")} value={style.background} onChange={v => change('background', v)} /><NumberControl label={t("app.editor.controls.backgroundOpacity")} value={style.backgroundOpacity * 100} min={0} max={100} onChange={n => change('backgroundOpacity', n / 100)} /><WordTimingControls item={item} onChange={onChange} /><TypographyControls style={style} onChange={style=>onChange({style})} /><AnimationControls item={item} onChange={onChange} /><MotionControls item={item} frame={frame} onChange={onChange} />
    </div>;
}
