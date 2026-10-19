'use client';
import { helperCopy } from '../../../../lib/i18n/helperCopy.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { exportProjectFile, readProjectFile } from '../../_lib/editorProjectFile.mjs';

/** onLoadTimeline(next, details) owns the single undo boundary and ordinary source relinking. */
export function ProjectFileControls({ tl, onLoadTimeline, disabled = false, openDisabled = false, name = 'veyrnox-studio-project', projectDocument = null, compact = false }) {
  const { t, locale } = useI18n();
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
            setStatus(t("app.editor.projectFiles.downloaded"));
        } catch (e) { setError(e.message || t("app.editor.projectFiles.downloadFailed")); }
        finally { link?.remove(); }
    }
    async function open(event) {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file || disabled || running.current || !onLoadTimeline) return;
        const snapshot = tl; running.current = true; setBusy(true); setError(''); setStatus('');
        try {
            const imported = await readProjectFile(file);
            if (!alive.current) return;
            if (current.current.disabled || current.current.tl !== snapshot) throw new Error(t("app.editor.projectFiles.changed"));
            if (onLoadTimeline(imported.timeline, imported) === false) throw new Error(t("app.editor.projectFiles.loadFailed"));
            setStatus(t("app.editor.projectFiles.opened"));
        } catch (e) { if (alive.current) setError(e.message || t("app.editor.projectFiles.openFailed")); }
        finally { running.current = false; if (alive.current) setBusy(false); }
    }
    const controls = <>
        <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={disabled || busy} data-testid="project-file-download" onClick={download}>{t("app.editor.projectFiles.download")}</Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled || openDisabled || busy || !onLoadTimeline} onClick={() => chooser.current?.click()}>{t("app.editor.projectFiles.open")}</Button>
            <input data-testid="project-file-input" ref={chooser} aria-label={t("app.editor.projectFiles.choose")} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} disabled={disabled || openDisabled || busy || !onLoadTimeline} onChange={open} />
        </div>
        <p className="text-[10px] text-vx-fg-muted">{t("app.editor.projectFiles.help")}</p>
        {openDisabled && <p className="text-[10px] text-vx-fg-muted">{t("app.editor.projectFiles.detach")}</p>}
        {busy && <p role="status" className="text-xs">{t("app.editor.projectFiles.opening")}</p>}
        {error && <p role="alert" className="text-xs">{helperCopy(t, locale, error)}</p>}
        {status && <p data-testid="project-file-status" role="status" className="text-xs">{status}</p>}
    </>;
    if (compact) return <details className="group relative shrink-0">
        <summary data-testid="project-files-toggle" className="cursor-pointer list-none whitespace-nowrap rounded-lg border border-vx-border bg-vx-base/60 px-3 py-2 text-xs font-semibold transition-colors hover:border-vx-accent [&::-webkit-details-marker]:hidden"><span className="sm:hidden">{t("app.chat.settings.tool.files")}</span><span className="hidden sm:inline">{t("app.editor.projectFiles.title")}</span></summary>
        <section data-testid="project-files" aria-label={t("app.editor.projectFiles.local")} className="fixed inset-x-4 top-auto z-50 mt-2 max-h-[calc(100dvh-8rem)] w-auto space-y-2 overflow-y-auto rounded-xl border border-vx-border bg-vx-panel p-3 shadow-2xl sm:absolute sm:inset-x-auto sm:end-0 sm:top-full sm:w-[min(24rem,calc(100vw-2rem))]">{controls}</section>
    </details>;
    return <section data-testid="project-files" aria-label={t("app.editor.projectFiles.local")} className="space-y-2">{controls}</section>;
}
