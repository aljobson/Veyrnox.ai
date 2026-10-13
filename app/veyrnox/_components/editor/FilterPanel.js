'use client';
import { useState } from 'react';
import { Button } from '../Button';
import { FILTER_LOOKS, FILTER_CATEGORIES, searchFilterLooks, filterSelectionProblem, applyFilterLook, resetFilterGrade } from '../../_lib/editorFilters.mjs';

export function FilterPanel({ tl, selected, selection = [], disabled, apply }) {
    const [query, setQuery] = useState(''), [category, setCategory] = useState('All');
    const [presetId, setPresetId] = useState('warm-film'), [intensity, setIntensity] = useState(100), [scope, setScope] = useState('current');
    const current = selected?.track === 'video' ? [selected] : [];
    const visuals = selection.filter(item => item.track === 'video');
    const targets = scope === 'selected' ? visuals : current;
    const problem = filterSelectionProblem(tl, targets), preset = FILTER_LOOKS.find(item => item.id === presetId);
    const matches = searchFilterLooks(query, category);
    return <section aria-label="Original filter catalog" className="space-y-3">
        <h2 className="text-sm font-bold">Original looks</h2>
        <input aria-label="Search filters" type="search" value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs" placeholder="Search looks or colour treatments" />
        <label className="block text-xs">Filter category<select aria-label="Filter category" value={category} onChange={event => setCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs">{FILTER_CATEGORIES.map(name => <option key={name}>{name}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2" aria-label="Filter results">
            {matches.map(item => <button key={item.id} type="button" aria-pressed={presetId === item.id} onClick={() => setPresetId(item.id)} className={`rounded-lg border p-2 text-left text-xs ${presetId === item.id ? 'border-vx-accent bg-vx-accent/10' : 'border-vx-border bg-vx-base'}`}><span className="block font-semibold">{item.name}</span><span className="block text-vx-fg-muted">{item.category}</span></button>)}
        </div>
        {!matches.length && <p role="status" className="text-xs text-vx-fg-muted">No looks match. Try another search or category.</p>}
        <div className="space-y-2 border-t border-vx-border pt-3">
            <p className="text-xs"><strong>{preset.name}</strong> · {preset.description}</p>
            <label className="block text-xs">Filter strength · {intensity}%<input aria-label="Filter strength (%)" type="range" min="0" max="100" step="1" value={intensity} disabled={disabled} onChange={event => setIntensity(Number(event.target.value))} className="mt-1 w-full" /></label>
            <label className="block text-xs">Apply filter to<select aria-label="Apply filter to" value={scope} onChange={event => setScope(event.target.value)} className="mt-1 w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs"><option value="current">Current visual clip</option><option value="selected">Selected visual clips ({visuals.length})</option></select></label>
            {problem && <p role="status" className="text-xs text-vx-fg-muted">{problem}</p>}
            <Button size="sm" disabled={disabled || !!problem || intensity === 0} onClick={() => apply(timeline => applyFilterLook(timeline, targets, presetId, intensity / 100))}>Apply look{targets.length > 1 ? ` to ${targets.length} clips` : ''}</Button>
            <Button size="sm" variant="ghost" disabled={disabled || !!problem} onClick={() => apply(timeline => resetFilterGrade(timeline, targets))}>Reset colour grade</Button>
            <p className="text-xs text-vx-fg-muted">Strength blends this look with the current colours. Curves, motion, masks and effects stay in place. Apply to several clips makes one edit for Undo. Reset clears colour grading, including curves and animated grading.</p>
        </div>
    </section>;
}
