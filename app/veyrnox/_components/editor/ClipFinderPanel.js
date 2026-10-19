'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../Button';
import { formatTime } from '../../_lib/editorTimeline.mjs';
import { insertClipSegments } from '../../_lib/editorClipFinder.mjs';
import { checkClipForFinder, findClips, pickRows, tickedPicks } from '../../_lib/editorClipRun.mjs';

const NONE = [];
// ADR-0105 slice C. Suggests the best short stretches of the selected video clip, each with its reasons, and adds the ticked ones after the
// timeline as one undoable edit. Runs on this device: no upload, no model, no credits.
export function ClipFinderPanel({ tl, blobs, disabled, selected, apply, onSeek, onError, onBusy, onPreview }) {
  const { t, locale } = useI18n();
    const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
    const time = value => locale === 'en' ? formatTime(value) : formatTime(value).replace(/\d+/g, part => new Intl.NumberFormat(localeTag(locale), {useGrouping:false,minimumIntegerDigits:part.length}).format(Number(part)));
    const item = selected?.track === 'video' ? tl.video.find(c => c.id === selected.id) : null;
    const media = item ? tl.media[item.mediaId] : null;
    const key = item ? `${item.id}:${item.mediaId}:${item.start}:${item.in}:${item.len}:${tl.text.length}` : '';
    const [run, setRun] = useState({ status: 'idle', progress: 0, rows: [], key: '', hadAudio: true });
    const abort = useRef(null);
    const fresh = run.key === key && run.status === 'done';
    const rows = useMemo(() => (fresh ? run.rows : NONE), [fresh, run.rows]);
    const blocker = item ? checkClipForFinder(media, item) : t("app.editor.detect.select");

    useEffect(() => { onPreview?.(rows.map(r => ({ frame: r.frame, kind: 'pick', ticked: r.ticked }))); }, [rows, onPreview]);
    useEffect(() => () => { abort.current?.abort(); onPreview?.([]); }, [onPreview]);

    async function find() {
        const blob = blobs.current.get(item.mediaId);
        if (!blob) { onError?.(t("app.editor.detect.relink")); return; }
        const controller = new AbortController(); abort.current = controller;
        setRun({ status: 'running', progress: 0, rows: [], key, hadAudio: true });
        onBusy?.(true);
        try {
            const result = await findClips(blob, tl, item, { signal: controller.signal, onProgress: p => setRun(r => (r.status === 'running' ? { ...r, progress: p } : r)) });
            if (result.error) throw new Error(result.error);
            setRun({ status: 'done', progress: 1, rows: pickRows(item, result.picks), key, hadAudio: result.hadAudio });
        } catch (error) {
            setRun({ status: 'idle', progress: 0, rows: [], key: '', hadAudio: true });
            if (error.name !== 'AbortError') onError?.(error.message || t("app.editor.finder.failed"));
        } finally { abort.current = null; onBusy?.(false); }
    }
    const toggle = index => setRun(r => ({ ...r, rows: r.rows.map((x, i) => (i === index ? { ...x, ticked: !x.ticked } : x)) }));
    const add = () => {
        const next = apply(timeline => insertClipSegments(timeline, item.mediaId, tickedPicks(rows)));
        if (next) setRun({ status: 'idle', progress: 0, rows: [], key: '', hadAudio: true });
    };
    const count = tickedPicks(rows).length;

    return <section aria-label={t("app.editor.finder.title")} className="space-y-3">
        <h2 className="text-sm font-bold">{t("app.editor.finder.title")}</h2>
        <p className="text-xs text-vx-fg-muted">{t("app.editor.finder.help")}</p>
        {blocker && <p role="status" className="text-xs">{blocker}</p>}
        {run.status === 'running'
            ? <div className="space-y-2"><progress aria-label={t("app.editor.finder.progress")} className="w-full" value={run.progress} max={1} /><Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>{t("cinema.creatorWorkspace.cancel")}</Button></div>
            : <Button size="sm" disabled={disabled || !!blocker} onClick={find}>{fresh ? t("app.editor.finder.again") : t("app.editor.finder.find")}</Button>}
        {fresh && !run.hadAudio && <p role="status" className="text-xs">{t("app.editor.finder.silent")}</p>}
        {fresh && !rows.length && <p role="status" className="text-xs">{t("app.editor.finder.empty")}</p>}
        {!!rows.length && <ol aria-label={t("app.editor.finder.suggestions")} className="space-y-2">{rows.map((r, i) => <li key={`${r.start}-${r.end}`} className="rounded border border-vx-border p-2">
            <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" aria-label={t('app.editor.finder.range', {start: time(Math.round(r.start * 30)), end: time(Math.round(r.end * 30))})} checked={r.ticked} disabled={disabled} onChange={() => toggle(i)} />
                <button type="button" className="font-vx-mono underline" onClick={e => { e.preventDefault(); onSeek?.(r.frame); }}>{time(Math.round(r.start * 30))}–{time(Math.round(r.end * 30))}</button>
                <span className="text-vx-fg-muted">{locale === 'en' ? r.seconds.toFixed(1) : new Intl.NumberFormat(localeTag(locale), {minimumFractionDigits:1,maximumFractionDigits:1}).format(r.seconds)} s</span>
            </label>
            <ul className="mt-1 list-disc ps-5 text-[11px] text-vx-fg-muted">{r.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        </li>)}</ol>}
        {!!rows.length && <Button size="sm" disabled={disabled || !count} onClick={add}>{count ? t(pluralKey(t, locale, 'app.editor.finder.add', count), {count: number(count)}) : t("app.editor.finder.tick")}</Button>}
    </section>;
}
