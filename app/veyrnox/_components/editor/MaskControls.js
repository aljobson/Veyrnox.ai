'use client';
import { localeTag } from '../../../../lib/i18n/locales.mjs';

import { useI18n } from '../../../../components/I18nProvider';
import { Button } from '../Button';
import { NumberControl, SelectControl } from './EditorFields';
import { maskDefaults, evaluatedMask, maskKeyframe } from '../../_lib/editorMask.mjs';
export function MaskControls({ item, frame, onChange }) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale), {useGrouping:false, maximumFractionDigits:20}).format(value);
    const at = frame - item.start, settings = evaluatedMask(item, at), active = at >= 0 && at < item.len;
    function change(key, value) {
        const next = { ...settings, [key]: value };
        const maskKeyframes = item.maskKeyframes?.length && active && key !== 'inverted'
            ? [...item.maskKeyframes.filter(k => k.frame !== at), maskKeyframe({ ...item, maskSettings: next, maskKeyframes: [] }, at)].sort((a, b) => a.frame - b.frame) : item.maskKeyframes;
        onChange({ maskSettings: next, ...(maskKeyframes ? { maskKeyframes } : {}) });
    }
    return <div className="space-y-2">
        <SelectControl label={t("app.editor.mask.title")} value={item.mask || 'none'} options={['none', 'circle', 'rounded', 'horizontal', 'vertical']} onChange={mask => onChange({ mask, maskSettings: maskDefaults(mask), maskKeyframes: [] })} />
        {item.mask && item.mask !== 'none' && <>
            <label className="block text-xs"><input aria-label={t("app.editor.mask.invert")} type="checkbox" checked={settings.inverted} onChange={e => change('inverted', e.target.checked)} />{' '}{t("app.editor.mask.invert")}</label>
            <NumberControl label={t("app.editor.mask.feather")} value={settings.feather * 100} min={0} max={25} onChange={n => change('feather', n / 100)} />
            <div className="grid grid-cols-2 gap-2">{Object.keys({x:0,y:0,width:0,height:0}).map(key => <NumberControl key={key} label={t(`app.editor.mask.${key}`)} value={settings[key] * 100} min={key === 'x' || key === 'y' ? -100 : 5} max={200} onChange={n => change(key, n / 100)} />)}</div>
            <NumberControl label={t("app.editor.mask.rotation")} value={settings.rotation} min={-360} max={360} onChange={n => change('rotation', n)} />
            <Button size="sm" disabled={!active || (item.maskKeyframes?.length >= 40 && !item.maskKeyframes.some(k => k.frame === at))} onClick={() => onChange({ maskKeyframes: [...(item.maskKeyframes || []).filter(k => k.frame !== at), maskKeyframe(item, at)].sort((a,b) => a.frame - b.frame) })}>{t("app.editor.mask.add")}</Button>
            {(item.maskKeyframes || []).map(k => <div key={k.frame} className="flex items-center gap-1 text-xs"><span>{locale === 'en' ? (k.frame / 30).toFixed(2) : new Intl.NumberFormat(localeTag(locale),{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false}).format(k.frame / 30)}s</span><SelectControl label={t("app.editor.mask.easing",{frame:number(k.frame)})} value={k.easing} options={['linear','ease-in','ease-out','ease-in-out']} onChange={easing => onChange({ maskKeyframes: item.maskKeyframes.map(p => p.frame === k.frame ? { ...p, easing } : p) })} /><button type="button" aria-label={t("app.editor.mask.delete",{frame:number(k.frame)})} onClick={() => onChange({ maskKeyframes: item.maskKeyframes.filter(p => p.frame !== k.frame) })}>×</button></div>)}
            <Button size="sm" variant="ghost" onClick={() => onChange({ maskSettings: maskDefaults(item.mask), maskKeyframes: [] })}>{t("app.editor.mask.reset")}</Button>
        </>}
    </div>;
}
