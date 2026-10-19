'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useEffect, useState } from 'react';
import { Button } from '../Button';
import { EditorDeliveryPanel } from './EditorDeliveryPanel';
import { EDITOR_EXPORT_HEIGHTS, EDITOR_EXPORT_RATES, EXPORT_BITRATES } from '../../_lib/editorExportSettings.mjs';
import { timelineSize } from '../../_lib/editorRender.mjs';
export function ExportPanel({ tl, name, onName, height, onHeight, disabled, exporting, progress, result, blocker, onExport, onCancel, onCover }) {
  const { t, locale } = useI18n();
    const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
    const [frameRate, setFrameRate] = useState(30), [format, setFormat] = useState('mp4'), [quality, setQuality] = useState('standard'), [cover, setCover] = useState(null), [coverError, setCoverError] = useState('');
    const field = 'w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs', size = timelineSize(tl, height);
    useEffect(() => () => { if (cover) URL.revokeObjectURL(cover.url); }, [cover]);
    async function coverFrame() { try { const blob = await onCover(); setCover({ url: URL.createObjectURL(blob), name: 'veyrnox-cover.png' }); setCoverError(''); } catch { setCoverError(t("app.editor.export.coverFailed")); } }
    return <div className="space-y-2"><h3 className="text-xs font-bold">{t("app.editor.workspace.export")}</h3><fieldset disabled={disabled} className="space-y-2">
        <label className="block text-xs">{t("app.editor.export.fileName")}<input aria-label={t("app.editor.export.nameLabel")} className={field} value={name} maxLength={60} onChange={e => onName(e.target.value)} /></label>
        <label className="block text-xs">{t("app.editor.legacy.size")}<select aria-label={t("app.editor.export.sizeLabel")} className={field} value={height} onChange={e => onHeight(Number(e.target.value))}>{EDITOR_EXPORT_HEIGHTS.map(n => <option key={n} value={n}>{number(n)}p{n === 1440 ? ' · 2K' : n === 2160 ? ' · 4K' : ''}</option>)}</select></label><p className="text-[10px] text-vx-fg-muted">{t('app.editor.export.pixels', {width: number(size.width), height: number(size.height)})}</p>
        <label className="block text-xs">{t("app.projects.frameRate")}<select aria-label={t("app.editor.export.rateLabel")} className={field} value={frameRate} onChange={e => setFrameRate(Number(e.target.value))}>{EDITOR_EXPORT_RATES.map(n => <option key={n} value={n}>{t('app.editor.export.fps', {count: number(n)})}</option>)}</select></label>
        <label className="block text-xs">{t("app.editor.export.container")}<select data-testid="editor-export-format" aria-label={t("app.editor.export.formatLabel")} className={field} value={format} onChange={e => setFormat(e.target.value)}><option value="mp4">{t("app.editor.export.mp4")}</option><option value="mov">{t("app.editor.export.mov")}</option></select></label>
        <label className="block text-xs">{t("app.editor.export.quality")}<select aria-label={t("app.editor.export.qualityLabel")} className={field} value={quality} onChange={e => setQuality(e.target.value)}>{Object.entries(EXPORT_BITRATES).map(([q, rate]) => <option key={q} value={q}>{t('app.editor.export.bitrate', {quality: tOr(t, `app.editor.export.quality.${q}`, q), rate: number(rate / 1000000)})}</option>)}</select></label>
        <Button size="sm" disabled={!tl.video.length && !tl.audio.length && !tl.text.length || !!blocker} onClick={() => onExport({ frameRate, format, quality })}>{t('app.editor.export.action', {format: format.toUpperCase()})}</Button><Button size="sm" variant="ghost" onClick={coverFrame}>{t("app.editor.export.cover")}</Button>
    </fieldset>{blocker && <p className="text-xs">{blocker}</p>}{exporting && <><progress aria-label={t("app.editor.legacy.exportProgress")} value={progress} max={1} className="w-full" /><Button size="sm" onClick={onCancel}>{t("app.editor.legacy.cancelExport")}</Button></>}
    {result && <p role="status"><a className="text-xs text-vx-accent underline" href={result.url} download={result.name}>{t('app.editor.export.download', {name: result.name})}</a></p>}{result && <EditorDeliveryPanel result={result} />}{coverError && <p role="alert" className="text-xs">{coverError}</p>}{cover && <a className="block text-xs text-vx-accent underline" href={cover.url} download={cover.name}>{t("app.editor.export.downloadCover")}</a>}<p className="text-[10px] text-vx-fg-muted">{t("app.editor.export.note")}</p></div>;
}
