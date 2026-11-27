'use client';
import { helperCopy } from '../../../../lib/i18n/helperCopy.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useEffect, useState } from 'react';
import { Button } from '../Button';
import { ExportProgress, ExportReadyCard } from './ExportReadyCard';
import { EDITOR_EXPORT_HEIGHTS, EDITOR_EXPORT_RATES, EXPORT_BITRATES } from '../../_lib/editorExportSettings.mjs';
import { readEditorExportPreferences, writeEditorExportPreferences } from '../../_lib/editorExportPreferences.mjs';
import { timelineSize } from '../../_lib/editorRender.mjs';
export function ExportPanel({ tl, name, onName, height, onHeight, disabled, exporting, progress, preview, result, error, blocker, onExport, onCancel, onCover, onDone }) {
  const { t, locale } = useI18n();
    const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
    const [frameRate, setFrameRate] = useState(30), [format, setFormat] = useState('mp4'), [quality, setQuality] = useState('standard'), [preferencesReady, setPreferencesReady] = useState(false), [cover, setCover] = useState(null), [coverError, setCoverError] = useState('');
    const field = 'w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs', size = timelineSize(tl, height);
    useEffect(() => () => { if (cover) URL.revokeObjectURL(cover.url); }, [cover]);
    useEffect(() => {
        const saved = readEditorExportPreferences(globalThis.localStorage);
        onHeight(saved.height); setFrameRate(saved.frameRate); setFormat(saved.format); setQuality(saved.quality); setPreferencesReady(true);
        // Export preferences are device-local and deliberately not part of a project document.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        if (preferencesReady) writeEditorExportPreferences(globalThis.localStorage, { height, frameRate, format, quality });
    }, [preferencesReady, height, frameRate, format, quality]);
    async function coverFrame() { try { const blob = await onCover(); setCover({ url: URL.createObjectURL(blob), name: 'veyrnox-cover.png' }); setCoverError(''); } catch { setCoverError(t("app.editor.export.coverFailed")); } }
    return <div className="space-y-2"><h3 className="text-xs font-bold">{t("app.editor.workspace.export")}</h3><fieldset disabled={disabled} className="space-y-2">
        <label className="block text-xs">{t("app.editor.export.fileName")}<input aria-label={t("app.editor.export.nameLabel")} className={field} value={name} maxLength={60} onChange={e => onName(e.target.value)} /></label>
        <label className="block text-xs">{t("app.editor.legacy.size")}<select aria-label={t("app.editor.export.sizeLabel")} className={field} value={height} onChange={e => onHeight(Number(e.target.value))}>{EDITOR_EXPORT_HEIGHTS.map(n => <option key={n} value={n}>{number(n)}p{n === 1440 ? ' · 2K' : n === 2160 ? ' · 4K' : ''}</option>)}</select></label><p className="text-[10px] text-vx-fg-muted">{t('app.editor.export.pixels', {width: number(size.width), height: number(size.height)})}</p>
        <label className="block text-xs">{t("app.projects.frameRate")}<select aria-label={t("app.editor.export.rateLabel")} className={field} value={frameRate} onChange={e => setFrameRate(Number(e.target.value))}>{EDITOR_EXPORT_RATES.map(n => <option key={n} value={n}>{t('app.editor.export.fps', {count: number(n)})}</option>)}</select></label>
        <label className="block text-xs">{t("app.editor.export.container")}<select data-testid="editor-export-format" aria-label={t("app.editor.export.formatLabel")} className={field} value={format} onChange={e => setFormat(e.target.value)}><option value="mp4">{t("app.editor.export.mp4")}</option><option value="mov">{t("app.editor.export.mov")}</option></select></label>
        <label className="block text-xs">{t("app.editor.export.quality")}<select aria-label={t("app.editor.export.qualityLabel")} className={field} value={quality} onChange={e => setQuality(e.target.value)}>{Object.entries(EXPORT_BITRATES).map(([q, rate]) => <option key={q} value={q}>{t('app.editor.export.bitrate', {quality: tOr(t, `app.editor.export.quality.${q}`, q), rate: number(rate / 1000000)})}</option>)}</select></label>
        <Button size="sm" disabled={!tl.video.length && !tl.audio.length && !tl.text.length || !!blocker} onClick={() => onExport({ frameRate, format, quality })}>{t('app.editor.export.action', {format: format.toUpperCase()})}</Button><Button size="sm" variant="ghost" onClick={coverFrame}>{t("app.editor.export.cover")}</Button>
    </fieldset>{blocker && <p className="text-xs">{helperCopy(t, locale, blocker)}</p>}{exporting && <ExportProgress progress={progress} preview={preview}><Button size="sm" variant="ghost" onClick={onCancel}>{t("app.editor.legacy.cancelExport")}</Button></ExportProgress>}
    {error && <p role="alert" data-testid="editor-export-error" className="rounded-lg border border-vx-danger/40 bg-vx-danger/10 p-3 text-xs text-vx-danger">{error}</p>}{result && <ExportReadyCard result={result} onDone={onDone} />}{coverError && <p role="alert" className="text-xs">{coverError}</p>}{cover && <a className="block text-xs text-vx-accent underline" href={cover.url} download={cover.name}>{t("app.editor.export.downloadCover")}</a>}<p className="text-[10px] text-vx-fg-muted">{t("app.editor.export.note")}</p></div>;
}
