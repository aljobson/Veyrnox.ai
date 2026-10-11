'use client';
import { useState } from 'react';
import { Button } from '../Button';
import { NumberControl } from './EditorControls';
import { EDIT_TEMPLATES, insertEditTemplate, insertGraphic } from '../../_lib/editorPresets.mjs';
import { updateSequenceClip, trackFor, setSequenceTransition } from '../../_lib/editorSequence.mjs';
import { SHAPES } from '../../_lib/editorGraphics.mjs';
export function CatalogPanel({ panel, tl, selected, frame, disabled, apply, onSelect }) {
    const [query,setQuery]=useState('');
    const search=<input aria-label={`Search ${panel.toLowerCase()}`} className="w-full rounded border border-vx-border bg-vx-base p-2 text-xs" value={query} onChange={e=>setQuery(e.target.value)} />;
    const matches=name=>name.toLowerCase().includes(query.toLowerCase());
    const [mediaIds, setMediaIds] = useState([]), [headline, setHeadline] = useState('Your story'), [color, setColor] = useState('#32d6c5'), [intensity, setIntensity] = useState(0.5);
    const item = selected?.track === 'video' ? tl.video.find(c => c.id === selected.id) : null;
    const locked = item && trackFor(tl, item)?.locked;
    if (panel === 'Elements') return <div className="space-y-3"><h2 className="text-sm font-bold">Original elements</h2>{search}<label className="flex items-center justify-between text-xs">Element colour<input aria-label="Element colour" type="color" value={color} onChange={e => setColor(e.target.value)} /></label>{SHAPES.filter(matches).map(shape => <Button key={shape} size="sm" disabled={disabled} onClick={() => { const next = apply(t => insertGraphic(t, shape, color, frame)); if (next) onSelect({ track: 'video', id: `v${next.seq}` }); }}>{shape}</Button>)}</div>;
    if (panel === 'Templates') return <div className="space-y-3"><h2 className="text-sm font-bold">Original edit templates</h2>{search}<input aria-label="Template headline" className="w-full rounded bg-vx-base p-2 text-xs" maxLength={120} value={headline} onChange={e => setHeadline(e.target.value)} /><p className="text-xs text-vx-fg-muted">Choose media in order. Slideshow appends; picture in picture overlays at the playhead. Existing work is kept.</p>{Object.values(tl.media).filter(m => m.kind !== 'audio').map(m => <label key={m.id} className="block truncate text-xs"><input type="checkbox" checked={mediaIds.includes(m.id)} onChange={e => setMediaIds(ids => e.target.checked ? [...ids, m.id] : ids.filter(id => id !== m.id))} /> {m.name}</label>)}{EDIT_TEMPLATES.filter(matches).map(name => <Button key={name} size="sm" disabled={disabled} onClick={() => apply(t => insertEditTemplate(t, name, mediaIds, headline, frame))}>{name}</Button>)}</div>;
    if (panel === 'Effects') return <div className="space-y-3"><h2 className="text-sm font-bold">Original video effects</h2>{search}<p className="text-xs text-vx-fg-muted">Select a video or image layer.</p><NumberControl label="Effect intensity" value={intensity} min={0} max={1} onChange={setIntensity} />{['none', 'vignette', 'pixelate', 'grain'].filter(matches).map(type => <Button key={type} size="sm" disabled={disabled || !item || locked} onClick={() => apply(t => updateSequenceClip(t, 'video', item.id, { effect: { type, intensity } }))}>{type}</Button>)}</div>;
    return <div className="space-y-3"><h2 className="text-sm font-bold">Transitions</h2>{search}<p className="text-xs text-vx-fg-muted">Select a clip that follows another on the same video track.</p>{['dissolve', 'dip-black', 'wipe-left', 'slide', 'zoom'].filter(matches).map(transitionType => <Button key={transitionType} size="sm" disabled={disabled || !item || locked} onClick={() => apply(t => setSequenceTransition(t, item.id, transitionType, 15))}>{transitionType}</Button>)}</div>;
}
