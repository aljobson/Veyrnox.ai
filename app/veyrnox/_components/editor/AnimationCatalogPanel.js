'use client';
import { useId, useRef, useState } from 'react';
import { Button } from '../Button';
import { ANIMATION_CATALOG, LOOP_CATALOG, searchAnimations, animationSelectionProblem, applyAnimationCatalog, resetAnimationCatalog } from '../../_lib/editorAnimationCatalog.mjs';

export function AnimationCatalogPanel({ tl, selected, disabled, apply }) {
    const panelId=useId(),tabs=useRef({});
    const [mode,setMode]=useState('in'),[query,setQuery]=useState('');
    const switchTab=event=>{
        const modes=['in','out','loop'],index=modes.indexOf(mode);
        const next=event.key==='Home'?modes[0]:event.key==='End'?modes.at(-1):event.key==='ArrowRight'?modes[(index+1)%modes.length]:event.key==='ArrowLeft'?modes[(index+2)%modes.length]:null;
        if(next){event.preventDefault();setMode(next);tabs.current[next]?.focus();}
    };
    const [chosen,setChosen]=useState({in:'fade',out:'fade',loop:'sway'});
    const [duration,setDuration]=useState(15),[period,setPeriod]=useState(60),[amount,setAmount]=useState(50),[restart,setRestart]=useState(false);
    const problem=animationSelectionProblem(tl,selected),clip=!problem?tl[selected.track].find(item=>item.id===selected.id):null;
    const results=searchAnimations(mode,query),catalog=mode==='loop'?LOOP_CATALOG:ANIMATION_CATALOG,preset=catalog.find(item=>item.id===chosen[mode]);
    const current=clip?.animation?.[mode==='loop'?'combo':mode]||'none';
    return <section aria-label="Original animation catalog" className="space-y-3">
        <h2 className="text-sm font-bold">Animation catalog</h2>
        <div role="tablist" aria-label="Animation stage" className="flex gap-2">{[['in','In'],['out','Out'],['loop','Loop']].map(([id,name])=><button key={id} type="button" role="tab" id={`${panelId}-${id}`} ref={node=>{tabs.current[id]=node;}} tabIndex={mode===id?0:-1} aria-selected={mode===id} aria-controls={`${panelId}-results`} onKeyDown={switchTab} onClick={()=>setMode(id)} className={`flex-1 rounded border p-2 text-xs ${mode===id?'border-vx-accent bg-vx-accent/10':'border-vx-border'}`}>{name}</button>)}</div>
        <input aria-label="Search animations" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search animation movements" className="w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs" />
        <div id={`${panelId}-results`} role="tabpanel" aria-labelledby={`${panelId}-${mode}`} className="grid grid-cols-2 gap-2">{results.map(item=><button key={item.id} type="button" aria-pressed={chosen[mode]===item.id} onClick={()=>setChosen(value=>({...value,[mode]:item.id}))} className={`rounded-lg border p-2 text-left text-xs ${chosen[mode]===item.id?'border-vx-accent bg-vx-accent/10':'border-vx-border bg-vx-base'}`}><span className="block font-semibold">{item.name}</span><span className="block text-vx-fg-muted">{item.description}</span></button>)}</div>
        {!results.length&&<p role="status" className="text-xs text-vx-fg-muted">No movements match. Try another search.</p>}
        <p className="text-xs"><strong>{preset.name}</strong> · Current {mode==='loop'?'loop':mode}: {catalog.find(item=>item.id===current)?.name||current}</p>
        {mode==='loop'?<><label className="block text-xs">Loop period · {(period/30).toFixed(2)} seconds<input aria-label="Loop period (frames)" type="range" min="1" max="600" step="1" value={period} disabled={disabled} onChange={event=>setPeriod(Number(event.target.value))} className="mt-1 w-full" /></label><label className="block text-xs">Loop strength · {amount}%<input aria-label="Loop strength (%)" type="range" min="0" max="100" step="1" value={amount} disabled={disabled} onChange={event=>setAmount(Number(event.target.value))} className="mt-1 w-full" /></label></>:<label className="block text-xs">In and Out duration · {(duration/30).toFixed(2)} seconds<input aria-label="In and Out duration (frames)" type="range" min="1" max="120" step="1" value={duration} disabled={disabled} onChange={event=>setDuration(Number(event.target.value))} className="mt-1 w-full" /></label>}
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={restart} disabled={disabled} onChange={event=>setRestart(event.target.checked)} />Restart animation timing from this clip’s current start</label>
        {clip?.animation?.offset>0&&!restart&&<p className="text-xs text-vx-fg-muted">This trimmed clip keeps its original animation phase. Choose restart to begin at its current start.</p>}
        {problem&&<p role="status" className="text-xs text-vx-fg-muted">{problem}</p>}
        <Button size="sm" disabled={disabled||!!problem} onClick={()=>apply(timeline=>applyAnimationCatalog(timeline,selected,mode,chosen[mode],{duration,period,amount:amount/100,restart}))}>Apply {mode==='loop'?'loop':mode==='in'?'In':'Out'} animation</Button>
        <Button size="sm" variant="ghost" disabled={disabled||!!problem} onClick={()=>apply(timeline=>resetAnimationCatalog(timeline,selected))}>Clear preset animations</Button>
        <p className="text-xs text-vx-fg-muted">Apply affects this clip, title or caption in one edit for Undo. Motion keyframes stay in place. In and Out share one duration; long durations can overlap on short clips.</p>
    </section>;
}
