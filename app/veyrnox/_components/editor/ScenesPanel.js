'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../Button';
import { formatTime } from '../../_lib/editorTimeline.mjs';
import { splitSequenceAtFrames } from '../../_lib/editorSequence.mjs';
import { checkSequenceClipForScenes, detectClipScenes, sceneRows, tickedFrames } from '../../_lib/editorSceneRun.mjs';

const NONE = [];
// ADR-0105 slice B. Finds shot changes in the selected video clip, previews them on the timeline and adds the ticked ones as one undoable edit.
export function ScenesPanel({ tl, blobs, disabled, selected, apply, onSeek, onError, onBusy, onPreview }) {
  const { t, locale } = useI18n();
    const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
    const time = value => locale === 'en' ? formatTime(value) : formatTime(value).replace(/\d+/g, part => new Intl.NumberFormat(localeTag(locale), {useGrouping:false,minimumIntegerDigits:part.length}).format(Number(part)));
    const item = selected?.track === 'video' ? tl.video.find(c => c.id === selected.id) : null;
    const media = item ? tl.media[item.mediaId] : null;
    const key = item ? `${item.id}:${item.mediaId}:${item.start}:${item.in}:${item.len}` : '';
    const [run, setRun] = useState({ status: 'idle', progress: 0, rows: [], key: '' });
    const abort = useRef(null);
    const fresh = run.key === key && run.status === 'done';
    const rows = useMemo(() => (fresh ? run.rows : NONE), [fresh, run.rows]);
    const blocker = item ? checkSequenceClipForScenes(media, item) : t("app.editor.detect.select");

    useEffect(() => { onPreview?.(rows.map(r => ({ frame: r.frame, kind: r.kind, ticked: r.ticked }))); }, [rows, onPreview]);
    useEffect(() => () => { abort.current?.abort(); onPreview?.([]); }, [onPreview]);

    async function detect() {
        const blob = blobs.current.get(item.mediaId);
        if (!blob) { onError?.(t("app.editor.detect.relink")); return; }
        const controller = new AbortController(); abort.current = controller;
        setRun({ status: 'running', progress: 0, rows: [], key });
        onBusy?.(true);
        try {
            const result = await detectClipScenes(blob, item, { signal: controller.signal, onProgress: p => setRun(r => r.status === 'running' ? { ...r, progress: p } : r) });
            if (result.error) throw new Error(result.error);
            setRun({ status: 'done', progress: 1, rows: sceneRows(item, result.cuts), key });
        } catch (error) {
            setRun({ status: 'idle', progress: 0, rows: [], key: '' });
            if (error.name !== 'AbortError') onError?.(error.message || t("app.editor.scenes.failed"));
        } finally { abort.current = null; onBusy?.(false); }
    }
    const toggle = frame => setRun(r => ({ ...r, rows: r.rows.map(x => x.frame === frame ? { ...x, ticked: !x.ticked } : x) }));
    const add = () => {
        const next = apply(timeline => splitSequenceAtFrames(timeline, 'video', item.id, tickedFrames(rows)));
        if (next) setRun({ status: 'idle', progress: 0, rows: [], key: '' });
    };
    const hard = rows.filter(r => r.kind === 'hard'), possible = rows.filter(r => r.kind !== 'hard'), count = tickedFrames(rows).length;
    const list = (title, items, note) => !!items.length && <div className="space-y-1">
        <h3 className="text-xs font-bold">{title} ({number(items.length)})</h3>{note && <p className="text-[10px] text-vx-fg-muted">{note}</p>}
        <ul className="space-y-1">{items.map(r => <li key={r.frame} className="flex items-center gap-2 text-xs">
            <input type="checkbox" aria-label={t('app.editor.scenes.at', {time: time(r.frame)})} checked={r.ticked} disabled={disabled} onChange={() => toggle(r.frame)} />
            <button type="button" className="font-vx-mono underline" onClick={() => onSeek?.(r.frame)}>{time(r.frame)}</button>
        </li>)}</ul></div>;

    return <section aria-label={t("app.editor.scenes.title")} className="space-y-3">
        <h2 className="text-sm font-bold">{t("app.editor.scenes.title")}</h2>
        <p className="text-xs text-vx-fg-muted">{t("app.editor.scenes.help")}</p>
        {blocker && <p role="status" className="text-xs">{blocker}</p>}
        {run.status === 'running'
            ? <div className="space-y-2"><progress aria-label={t("app.editor.scenes.progress")} className="w-full" value={run.progress} max={1} /><Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>{t("cinema.creatorWorkspace.cancel")}</Button></div>
            : <Button size="sm" disabled={disabled || !!blocker} onClick={detect}>{fresh ? t("app.editor.scenes.again") : t("app.editor.scenes.detect")}</Button>}
        {fresh && !rows.length && <p role="status" className="text-xs">{t("app.editor.scenes.empty")}</p>}
        {list(t("app.editor.scenes.cuts"), hard)}
        {list(t("app.editor.scenes.dissolves"), possible, t("app.editor.scenes.review"))}
        {fresh && !!rows.length && <Button size="sm" disabled={disabled || !count} onClick={add}>{count ? t(pluralKey(t, locale, 'app.editor.scenes.add', count), {count: number(count)}) : t("app.editor.scenes.tick")}</Button>}
    </section>;
}
