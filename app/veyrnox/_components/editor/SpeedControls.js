'use client';
import { localeTag } from '../../../../lib/i18n/locales.mjs';

import { useI18n } from '../../../../components/I18nProvider';
import {useState} from 'react';
import {Button} from '../Button';
import {NumberControl,SelectControl} from './EditorFields';
import {SPEED_PRESETS,visibleSpeedPoints} from '../../_lib/editorSpeed.mjs';
export function SpeedControls({item,frame,onCurve,onReverse,onFreeze,onRate}) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale), {useGrouping:false, maximumFractionDigits:20}).format(value);
    const [points,setPoints]=useState(()=>visibleSpeedPoints(item));
    if(item.freezeFrame!==undefined)return <p className="text-xs">{t("app.editor.speed.freezeHelp")}</p>;
    return <div className="space-y-2">
        <SelectControl label={t("app.editor.speed.preset")} value="custom" options={['custom','constant',...Object.keys(SPEED_PRESETS)]} onChange={name=>{if(name==='constant')onRate(item.rate || 1);else if(SPEED_PRESETS[name])onCurve(SPEED_PRESETS[name]);}} />
        <p className="text-[10px] text-vx-fg-muted">{t("app.editor.speed.help")}</p>
        <svg viewBox="0 0 100 100" role="img" aria-label={t("app.editor.speed.curve")} className="w-full border border-vx-border"><polyline fill="none" stroke="#2dd4bf" strokeWidth="2" points={points.map(p=>`${p.position*100},${100-p.rate/8*100}`).join(' ')} /></svg>
        {points.map((p,i)=><div key={i} className="grid grid-cols-2 gap-2"><NumberControl label={t("app.editor.speed.position",{n:number(i+1)})} disabled={i===0 || i===points.length-1} value={p.position*100} min={i?points[i-1].position*100+.1:0} max={i===points.length-1?100:points[i+1].position*100-.1} onChange={n=>setPoints(points.map((v,k)=>k===i?{...v,position:n/100}:v))} /><NumberControl label={t("app.editor.speed.rate",{n:number(i+1)})} value={p.rate} min={.1} max={8} step={.1} onChange={n=>setPoints(points.map((v,k)=>k===i?{...v,rate:n}:v))} />{i>0 && i<points.length-1 && <button type="button" aria-label={t("app.editor.speed.delete",{n:number(i+1)})} className="text-xs" onClick={()=>setPoints(points.filter((_,k)=>k!==i))}>{t("app.editor.colour.remove")}</button>}</div>)}
        <Button size="sm" disabled={points.length>=12} onClick={()=>{const gaps=points.slice(1).map((p,i)=>({position:(points[i].position+p.position)/2,rate:(points[i].rate+p.rate)/2,gap:p.position-points[i].position})).sort((a,b)=>b.gap-a.gap),{position,rate}=gaps[0];setPoints([...points,{position,rate}].sort((a,b)=>a.position-b.position));}}>{t("app.editor.speed.add")}</Button>
        <Button size="sm" onClick={()=>onCurve(points)}>{t("app.editor.speed.apply")}</Button>
        <Button size="sm" aria-pressed={!!item.reverse} onClick={onReverse}>{t("app.editor.speed.reverse")}</Button>
        {onFreeze && <Button size="sm" disabled={frame<item.start || frame>=item.start+item.len} onClick={onFreeze}>{t("app.editor.speed.freeze")}</Button>}
    </div>;
}
