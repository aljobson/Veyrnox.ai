'use client';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { helperCopy } from '../../../../lib/i18n/helperCopy.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../components/I18nProvider';
const MODES = ['in','out','loop'];
import { useId, useRef, useState } from 'react';
import { Button } from '../Button';
import { ANIMATION_CATALOG, LOOP_CATALOG, searchAnimations, animationSelectionProblemDiagnostic as animationSelectionProblem, applyAnimationCatalog, resetAnimationCatalog } from '../../_lib/editorAnimationCatalog.mjs';

export function AnimationCatalogPanel({ tl, selected, disabled, apply }) {
  const { t, locale } = useI18n();
  const number = n => locale === 'en' ? String(n) : n.toLocaleString(localeTag(locale));
  const seconds = frames => locale === 'en' ? (frames/30).toFixed(2) : (frames/30).toLocaleString(localeTag(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const modeLabel = id => id === 'loop' ? t('app.editor.animCatalog.loop') : id === 'in' ? t('app.editor.sheet.in') : t('app.editor.sheet.out');
    const panelId=useId(),tabs=useRef({});
    const [mode,setMode]=useState('in'),[query,setQuery]=useState('');
    const switchTab=event=>{
        const modes=MODES,index=modes.indexOf(mode);
        const next=event.key==='Home'?modes[0]:event.key==='End'?modes.at(-1):event.key==='ArrowRight'?modes[(index+1)%modes.length]:event.key==='ArrowLeft'?modes[(index+2)%modes.length]:null;
        if(next){event.preventDefault();setMode(next);tabs.current[next]?.focus();}
    };
    const [chosen,setChosen]=useState({in:'fade',out:'fade',loop:'sway'});
    const [duration,setDuration]=useState(15),[period,setPeriod]=useState(60),[amount,setAmount]=useState(50),[restart,setRestart]=useState(false);
    const problem=animationSelectionProblem(tl,selected),clip=!problem?tl[selected.track].find(item=>item.id===selected.id):null;
    const results=searchAnimations(mode,query),catalog=mode==='loop'?LOOP_CATALOG:ANIMATION_CATALOG,preset=catalog.find(item=>item.id===chosen[mode]);
    const current=clip?.animation?.[mode==='loop'?'combo':mode]||'none';
    return <section aria-label={t("app.editor.animCatalog.region")} className="space-y-3">
        <h2 className="text-sm font-bold">{t("app.editor.animCatalog.title")}</h2>
        <div role="tablist" aria-label={t("app.editor.animCatalog.stage")} className="flex gap-2">{MODES.map(id=><button key={id} type="button" role="tab" id={`${panelId}-${id}`} ref={node=>{tabs.current[id]=node;}} tabIndex={mode===id?0:-1} aria-selected={mode===id} aria-controls={`${panelId}-results`} onKeyDown={switchTab} onClick={()=>setMode(id)} className={`flex-1 rounded border p-2 text-xs ${mode===id?'border-vx-accent bg-vx-accent/10':'border-vx-border'}`}>{modeLabel(id)}</button>)}</div>
        <input aria-label={t("app.editor.animCatalog.search")} type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={t("app.editor.animCatalog.placeholder")} className="w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs" />
        <div id={`${panelId}-results`} role="tabpanel" aria-labelledby={`${panelId}-${mode}`} className="grid grid-cols-2 gap-2">{results.map(item=><button key={item.id} type="button" aria-pressed={chosen[mode]===item.id} onClick={()=>setChosen(value=>({...value,[mode]:item.id}))} className={`rounded-lg border p-2 text-start text-xs ${chosen[mode]===item.id?'border-vx-accent bg-vx-accent/10':'border-vx-border bg-vx-base'}`}><span className="block font-semibold">{item.name}</span><span className="block text-vx-fg-muted">{tOr(t, `app.data.${mode === 'loop' ? 'loop' : 'animation'}.${item.id}`, item.description)}</span></button>)}</div>
        {!results.length&&<p role="status" className="text-xs text-vx-fg-muted">{t("app.editor.animCatalog.empty")}</p>}
        <p className="text-xs"><strong>{preset.name}</strong>{t('app.editor.animCatalog.current', { mode: locale === 'en' ? mode : modeLabel(mode), name: catalog.find(item=>item.id===current)?.name||current })}</p>
        {mode==='loop'?<><label className="block text-xs">{t('app.editor.animCatalog.period', { seconds: seconds(period) })}<input aria-label={t("app.editor.animCatalog.periodLabel")} type="range" min="1" max="600" step="1" value={period} disabled={disabled} onChange={event=>setPeriod(Number(event.target.value))} className="mt-1 w-full" /></label><label className="block text-xs">{t('app.editor.animCatalog.strength', { percent: number(amount) })}<input aria-label={t("app.editor.animCatalog.strengthLabel")} type="range" min="0" max="100" step="1" value={amount} disabled={disabled} onChange={event=>setAmount(Number(event.target.value))} className="mt-1 w-full" /></label></>:<label className="block text-xs">{t('app.editor.animCatalog.duration', { seconds: seconds(duration) })}<input aria-label={t("app.editor.animCatalog.durationLabel")} type="range" min="1" max="120" step="1" value={duration} disabled={disabled} onChange={event=>setDuration(Number(event.target.value))} className="mt-1 w-full" /></label>}
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={restart} disabled={disabled} onChange={event=>setRestart(event.target.checked)} />{t("app.editor.animCatalog.restart")}</label>
        {clip?.animation?.offset>0&&!restart&&<p className="text-xs text-vx-fg-muted">{t("app.editor.animCatalog.trimmed")}</p>}
        {problem&&<p role="status" className="text-xs text-vx-fg-muted">{helperCopy(t, locale, problem)}</p>}
        <Button size="sm" disabled={disabled||!!problem} onClick={()=>apply(timeline=>applyAnimationCatalog(timeline,selected,mode,chosen[mode],{duration,period,amount:amount/100,restart}))}>{t('app.editor.animCatalog.apply', { mode: locale === 'en' && mode === 'loop' ? mode : modeLabel(mode) })}</Button>
        <Button size="sm" variant="ghost" disabled={disabled||!!problem} onClick={()=>apply(timeline=>resetAnimationCatalog(timeline,selected))}>{t("app.editor.animCatalog.clear")}</Button>
        <p className="text-xs text-vx-fg-muted">{t("app.editor.animCatalog.help")}</p>
    </section>;
}
