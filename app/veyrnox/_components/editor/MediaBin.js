'use client';
import { formatTime } from '../../_lib/editorTimeline.mjs';

export function MediaBin({ tl, onAdd, onRemove, disabled }) {
    const items = Object.values(tl.media);
    if (!items.length) return null;
    return <section aria-label="Project media" className="rounded-2xl border border-vx-border bg-vx-panel p-4">
        <h2 className="mb-3 text-sm font-bold">Project media <span className="font-normal text-vx-fg-muted">{items.length} files</span></h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{items.map(item => <li key={item.id} className="min-w-0 rounded-xl border border-vx-border bg-vx-base p-3">
            <p className="truncate text-sm font-bold" title={item.name}>{item.name}</p>
            <p className="my-1 text-xs text-vx-fg-muted">{item.kind === 'video' ? 'Video' : 'Audio'} · source {formatTime(item.frames)}</p>
            <button type="button" disabled={disabled} className="text-xs font-bold text-vx-accent disabled:opacity-40" onClick={() => onAdd(item.id)} aria-label={`Add ${item.name} to timeline`}>Add to timeline</button>
            <button type="button" disabled={disabled} className="ml-3 text-xs text-vx-fg-muted disabled:opacity-40" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.name} from project`}>Remove file</button>
        </li>)}</ul>
    </section>;
}
