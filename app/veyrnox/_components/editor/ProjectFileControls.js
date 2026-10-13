'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { exportProjectFile, readProjectFile } from '../../_lib/editorProjectFile.mjs';

/** onLoadTimeline(next, details) owns the single undo boundary and ordinary source relinking. */
export function ProjectFileControls({ tl, onLoadTimeline, disabled = false, openDisabled = false, name = 'veyrnox-studio-project', projectDocument = null, compact = false }) {
    const chooser = useRef(null), alive = useRef(true), current = useRef({ tl, disabled }), running = useRef(false), downloads = useRef(new Map());
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
    useEffect(() => { current.current = { tl, disabled }; }, [tl, disabled]);
    useEffect(() => {
        alive.current = true;
        const urls = downloads.current;
        return () => { alive.current = false; for (const [url, timer] of urls) { clearTimeout(timer); URL.revokeObjectURL(url); } urls.clear(); };
    }, []);
    function download() {
        if (disabled || running.current) return;
        setError(''); setStatus('');
        let link;
        try {
            const result = exportProjectFile(tl, { projectDocument, name }), url = URL.createObjectURL(new Blob([result.json], { type: 'application/json' }));
            const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.current.delete(url); }, 1000); downloads.current.set(url, timer);
            link = document.createElement('a'); link.href = url; link.download = result.name; document.body.appendChild(link); link.click();
            setStatus('Project file downloaded. Keep its original media and font files for relinking.');
        } catch (e) { setError(e.message || 'The project file could not be downloaded.'); }
        finally { link?.remove(); }
    }
    async function open(event) {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file || disabled || running.current || !onLoadTimeline) return;
        const snapshot = tl; running.current = true; setBusy(true); setError(''); setStatus('');
        try {
            const imported = await readProjectFile(file);
            if (!alive.current) return;
            if (current.current.disabled || current.current.tl !== snapshot) throw new Error('The edit changed while opening this file. Choose the project file again.');
            if (onLoadTimeline(imported.timeline, imported) === false) throw new Error('The project file could not be loaded into this edit.');
            setStatus('Project file opened. Relink any unavailable original media and custom fonts. Undo returns to the previous edit.');
        } catch (e) { if (alive.current) setError(e.message || 'The project file could not be opened.'); }
        finally { running.current = false; if (alive.current) setBusy(false); }
    }
    const controls = <>
        <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={disabled || busy} onClick={download}>Download project file</Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled || openDisabled || busy || !onLoadTimeline} onClick={() => chooser.current?.click()}>Open project file</Button>
            <input ref={chooser} aria-label="Choose project JSON file" type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} disabled={disabled || openDisabled || busy || !onLoadTimeline} onChange={open} />
        </div>
        <p className="text-[10px] text-vx-fg-muted">Project files contain your edits and media details. Keep the original media and font files; reopening may require relinking them.</p>
        {openDisabled && <p className="text-[10px] text-vx-fg-muted">Detach from the cloud project before opening a local project file.</p>}
        {busy && <p role="status" className="text-xs">Opening project file…</p>}
        {error && <p role="alert" className="text-xs">{error}</p>}
        {status && <p role="status" className="text-xs">{status}</p>}
    </>;
    if (compact) return <details className="group relative shrink-0">
        <summary className="cursor-pointer list-none rounded-lg border border-vx-border bg-vx-base/60 px-3 py-2 text-xs font-semibold transition-colors hover:border-vx-accent [&::-webkit-details-marker]:hidden">Project files</summary>
        <section aria-label="Local project files" className="absolute right-0 top-full z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] space-y-2 rounded-xl border border-vx-border bg-vx-panel p-3 shadow-2xl">{controls}</section>
    </details>;
    return <section aria-label="Local project files" className="space-y-2">{controls}</section>;
}
