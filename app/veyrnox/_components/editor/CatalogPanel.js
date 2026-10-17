'use client';

import { useState } from 'react';
import { NumberControl } from './EditorControls';
import { EDIT_TEMPLATE_CATALOG, insertEditTemplate, insertGraphic } from '../../_lib/editorPresets.mjs';
import { updateSequenceClip, trackFor, setSequenceTransition } from '../../_lib/editorSequence.mjs';
import { SHAPES } from '../../_lib/editorGraphics.mjs';
import { EFFECT_CATEGORIES, TRANSITION_CATEGORIES, TRANSITIONS, VIDEO_EFFECTS } from '../../_lib/editorEffects.mjs';
import { PersonProcessingControls } from './PersonProcessingControls';
import { TransitionPreview } from './TransitionPreview';
import { GuidanceCard } from './GuidanceCard';
import { transitionGuidance } from '../../_lib/editorGuidance.mjs';

const chip = active => `rounded-full border px-3 py-1.5 text-xs transition-colors ${active ? 'border-vx-accent bg-vx-accent/10 text-vx-accent' : 'border-vx-border text-vx-fg-muted hover:text-vx-fg'}`;

function PresetPreview({ item, kind }) {
    if (kind === 'transition') return <TransitionPreview id={item.id} />;
    if (kind === 'shape') return <span aria-hidden="true" className="flex aspect-video items-center justify-center rounded-md bg-gradient-to-br from-vx-accent/15 to-fuchsia-500/10 text-2xl font-black text-vx-accent">{item.symbol}</span>;
    if (kind === 'template') return <span aria-hidden="true" className="relative block aspect-video overflow-hidden rounded-md bg-gradient-to-br from-slate-950 to-slate-700"><span className="absolute left-2 top-2 h-1.5 w-2/3 rounded-full bg-white/75" /><span className="absolute left-2 top-5 h-1 w-1/2 rounded-full bg-vx-accent/80" /><span className="absolute inset-x-2 bottom-2 grid grid-cols-3 gap-1"><i className="h-5 rounded bg-white/15" /><i className="h-5 rounded bg-white/25" /><i className="h-5 rounded bg-white/15" /></span></span>;
    const backgrounds = {
        Basic: 'from-slate-900 via-slate-600 to-slate-950',
        Light: 'from-amber-200 via-orange-400 to-fuchsia-700',
        Retro: 'from-amber-700 via-rose-500 to-cyan-600',
        Glitch: 'from-cyan-500 via-slate-950 to-fuchsia-500',
        Style: 'from-violet-700 via-pink-500 to-amber-300',
    };
    return <span aria-hidden="true" className={`relative block aspect-video overflow-hidden rounded-md bg-gradient-to-br ${backgrounds[item.category] || backgrounds.Basic}`}><span className="absolute inset-0 bg-[linear-gradient(120deg,transparent_25%,rgba(255,255,255,.22)_50%,transparent_75%)]" /><span className="absolute bottom-1 left-2 text-[9px] font-bold uppercase tracking-widest text-white/90">{item.category}</span></span>;
}

function EmptyCatalog({ query }) {
    return <p role="status" className="rounded-lg border border-dashed border-vx-border p-4 text-center text-xs text-vx-fg-muted">No presets match “{query}”.</p>;
}

function PresetGrid({ items, disabled, onChoose, currentId, kind }) {
    if (!items.length) return null;
    return <div className="grid grid-cols-2 gap-2">{items.map(item => {
        const selected = currentId !== undefined && currentId === item.id;
        return <button key={item.id} type="button" aria-label={item.name} disabled={disabled} aria-pressed={currentId === undefined ? undefined : selected} onClick={() => onChoose(item.id)} className={`group min-w-0 rounded-xl border bg-vx-base p-1.5 text-left text-xs transition-all hover:-translate-y-0.5 hover:border-vx-accent hover:shadow-lg hover:shadow-black/10 disabled:translate-y-0 disabled:opacity-40 ${selected ? 'border-vx-accent ring-1 ring-vx-accent/50' : 'border-vx-border'}`}>
            <PresetPreview item={item} kind={kind} />
            <span className={`mt-2 block truncate px-0.5 font-bold ${selected ? 'text-vx-accent' : ''}`}>{item.name}</span>
            {item.description && <span className="mt-0.5 line-clamp-2 block px-0.5 text-xs leading-4 text-vx-fg-muted">{item.description}</span>}
        </button>;
    })}</div>;
}

const SHAPE_SYMBOLS = Object.freeze({
    circle: '●', rectangle: '■', triangle: '▲', star: '★', arrow: '➜', heart: '♥',
    'speech-bubble': '▰', checkmark: '✓', diamond: '◆', hexagon: '⬢', line: '━', ring: '○',
    cross: '✚', lightning: 'ϟ', burst: '✹', bracket: '[ ]', underline: '_', play: '▶', location: '⌖', sparkle: '✦',
});

export function CatalogPanel({ panel, tl, selected, frame, disabled, apply, onSelect, selectedBlob, localInference, onIngest, onBusy, onError, onOpenMedia }) {
    const [query, setQuery] = useState('');
    const [mediaIds, setMediaIds] = useState([]);
    const [headline, setHeadline] = useState('Your story');
    const [color, setColor] = useState('#32d6c5');
    const [intensity, setIntensity] = useState(0.5);
    const [effectTab, setEffectTab] = useState('Video effects');
    const [category, setCategory] = useState('All');
    const [transitionCategory, setTransitionCategory] = useState('All');
    const [transitionFrames, setTransitionFrames] = useState(15);
    const search = <input aria-label={`Search ${panel.toLowerCase()}`} placeholder="Search" className="w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs outline-none focus:border-vx-accent" value={query} onChange={event => setQuery(event.target.value)} />;
    const matches = name => name.toLowerCase().includes(query.trim().toLowerCase());
    const item = selected?.track === 'video' ? tl.video.find(clip => clip.id === selected.id) : null;
    const locked = item && trackFor(tl, item)?.locked;

    if (panel === 'Elements') {
        const elements = SHAPES.filter(matches).map(shape => ({ id: shape, name: shape.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' '), symbol: SHAPE_SYMBOLS[shape] }));
        return <div className="space-y-3"><div><h2 className="text-sm font-bold">Elements</h2><p className="mt-1 text-xs text-vx-fg-muted">Original, editable graphics for overlays and callouts.</p></div>{search}<label className="flex items-center justify-between text-xs">Element colour<input aria-label="Element colour" type="color" value={color} onChange={event => setColor(event.target.value)} /></label>{!elements.length && <EmptyCatalog query={query} />}<PresetGrid items={elements} kind="shape" disabled={disabled} onChoose={shape => { const next = apply(timeline => insertGraphic(timeline, shape, color, frame)); if (next) onSelect({ track: 'video', id: `v${next.seq}` }); }} /></div>;
    }

    if (panel === 'Templates') {
        const templates = EDIT_TEMPLATE_CATALOG.filter(template => matches(`${template.name} ${template.description}`)).map(template => ({ ...template, id: template.name }));
        const media = Object.values(tl.media).filter(source => source.kind !== 'audio');
        return <div className="space-y-3"><div><h2 className="text-sm font-bold">Templates</h2><p className="mt-1 text-xs text-vx-fg-muted">Editable layouts built from your own media.</p></div>{search}<input aria-label="Template headline" placeholder="Headline" className="w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs outline-none focus:border-vx-accent" maxLength={120} value={headline} onChange={event => setHeadline(event.target.value)} />{media.length ? <fieldset className="space-y-1"><legend className="mb-1 text-[11px] font-bold uppercase tracking-wider text-vx-fg-muted">Source media</legend>{media.map(source => <label key={source.id} className="flex items-center gap-2 truncate rounded px-1 py-1 text-xs hover:bg-vx-base"><input type="checkbox" checked={mediaIds.includes(source.id)} onChange={event => setMediaIds(ids => event.target.checked ? [...ids, source.id] : ids.filter(id => id !== source.id))} /> <span className="truncate">{source.name}</span></label>)}</fieldset> : <p className="rounded-lg border border-dashed border-vx-border p-3 text-xs text-vx-fg-muted">Import media for shot-based templates. Title and quote cards work without media.</p>}{!templates.length && <EmptyCatalog query={query} />}<PresetGrid items={templates} kind="template" disabled={disabled} onChoose={name => apply(timeline => insertEditTemplate(timeline, name, mediaIds, headline, frame))} /></div>;
    }

    if (panel === 'Effects') {
        const effects = VIDEO_EFFECTS.filter(effect => (category === 'All' || effect.category === category) && matches(`${effect.name} ${effect.category} ${effect.description}`));
        const video = tl.media[item?.mediaId]?.kind === 'video';
        return <div className="space-y-3"><div><h2 className="text-sm font-bold">Effects</h2><p className="mt-1 text-xs text-vx-fg-muted">Preview-safe looks and local body tools.</p></div><div role="tablist" aria-label="Effect type" className="flex gap-2">{['Video effects', 'Body effects'].map(tab => <button key={tab} type="button" role="tab" aria-selected={effectTab === tab} className={chip(effectTab === tab)} onClick={() => setEffectTab(tab)}>{tab}</button>)}</div>
            {effectTab === 'Video effects' ? <>{search}<NumberControl label="Effect intensity" value={intensity} min={0} max={1} step={0.05} onChange={setIntensity} /><div className="flex flex-wrap gap-1">{EFFECT_CATEGORIES.map(name => <button key={name} type="button" aria-pressed={category === name} className={chip(category === name)} onClick={() => setCategory(name)}>{name}</button>)}</div>{!effects.length && <EmptyCatalog query={query} />}<PresetGrid items={effects} currentId={item?.effect?.type || 'none'} disabled={disabled || !item || locked} onChoose={type => apply(timeline => updateSequenceClip(timeline, 'video', item.id, { effect: { type, intensity } }))} /></> : <>{!localInference && <p className="text-xs text-vx-fg-muted">Local person effects are not enabled for this workspace.</p>}{localInference && !video && <p className="rounded-lg border border-dashed border-vx-border p-3 text-xs text-vx-fg-muted">Select a video clip to use body effects.</p>}{localInference && video && <PersonProcessingControls key={`body:${item.id}`} media={tl.media[item.mediaId]} blob={selectedBlob} timeline={tl} disabled={disabled || locked} onIngest={onIngest} onBusy={onBusy} onError={onError} />}</>}
        </div>;
    }

    const transitions = TRANSITIONS.filter(transition => (transitionCategory === 'All' || transition.category === transitionCategory) && matches(`${transition.name} ${transition.category}`));
    return <div className="space-y-3"><div><h2 className="text-sm font-bold">Transitions</h2><p className="mt-1 text-xs text-vx-fg-muted">Place a transition between the selected clip and the one before it.</p></div><GuidanceCard hint={transitionGuidance(tl, selected)} onAction={onOpenMedia} />{search}<NumberControl label="Transition duration (seconds)" value={transitionFrames / 30} min={1 / 30} max={2} step={1 / 30} onChange={seconds => setTransitionFrames(Math.max(1, Math.round(seconds * 30)))} /><div className="flex flex-wrap gap-1">{TRANSITION_CATEGORIES.map(name => <button key={name} type="button" aria-pressed={transitionCategory === name} className={chip(transitionCategory === name)} onClick={() => setTransitionCategory(name)}>{name}</button>)}</div>{!transitions.length && <EmptyCatalog query={query} />}<PresetGrid items={transitions} kind="transition" currentId={item?.transitionType} disabled={disabled || !item || locked} onChoose={transitionType => apply(timeline => setSequenceTransition(timeline, item.id, transitionType, transitionFrames))} /></div>;
}
