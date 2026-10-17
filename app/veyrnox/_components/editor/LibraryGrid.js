'use client';
import { useState } from 'react';
import { libraryTile } from '../../_lib/editorLibraryTile.mjs';

function Preview({ tile }) {
    const [failed, setFailed] = useState(false);
    const symbol = <span aria-hidden="true" className="flex aspect-video items-center justify-center rounded-md bg-vx-panel text-2xl text-vx-fg-muted">{tile.symbol}</span>;
    if (failed || !tile.preview) return symbol;
    if (tile.preview.type === 'image') return <img src={tile.preview.url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="aspect-video w-full rounded-md bg-black object-cover" />;
    return <video src={`${tile.preview.url}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} onError={() => setFailed(true)} className="pointer-events-none aspect-video w-full rounded-md bg-black object-cover" />;
}

/** The account's Library as a grid of pictures. A file that cannot preview still shows its kind and name. */
export function LibraryGrid({ items, disabled, onPick }) {
    return <ul className="grid grid-cols-2 gap-2">{items.map(item => {
        const tile = libraryTile(item);
        return <li key={item.mediaId || `${item.jobId}:${item.stem || ''}`}>
            <button type="button" aria-label={tile.name} disabled={disabled} onClick={() => onPick(item)} className="group block w-full min-w-0 rounded-xl border border-vx-border bg-vx-base p-1.5 text-left text-xs transition-all hover:border-vx-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent disabled:opacity-40">
                <Preview tile={tile} />
                <span className="mt-1.5 block truncate px-0.5 font-bold">{item.label}</span>
                <span className="block truncate px-0.5 text-vx-fg-muted">{item.kind} · {tile.badge}</span>
            </button>
        </li>;
    })}</ul>;
}
