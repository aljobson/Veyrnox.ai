'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { Button } from '../Button';
import { EditorDeliveryPanel } from './EditorDeliveryPanel';

// Calm full-width progress: a big percentage, one line of reassurance, a way out.
export function ExportProgress({ progress, children }) {
  const { t, locale } = useI18n();
  const percent = Math.max(0, Math.min(100, Math.round((Number.isFinite(progress) ? progress : 0) * 100)));
  const shown = new Intl.NumberFormat(localeTag(locale)).format(percent);
  return <div className="space-y-2 text-center" data-testid="editor-export-progress">
    <p className="text-3xl font-black vx-num" aria-hidden="true">{shown}%</p>
    <progress aria-label={t('app.editor.legacy.exportProgress')} value={progress} max={1} className="w-full" />
    <p className="text-xs text-vx-fg-muted">{t('app.editor.export.keepOpen')}</p>
    {children}
  </div>;
}

// What the person sees when an export finishes: preview, one primary action,
// where the file is right now, the existing destinations, and Done.
export function ExportReadyCard({ result, onDone }) {
  const { t } = useI18n();
  return <section aria-label={t('app.editor.export.readyTitle')} data-testid="editor-export-ready" className="space-y-3 rounded-xl border border-vx-border p-3">
    <h3 className="text-sm font-black">{t('app.editor.export.readyTitle')}</h3>
    {!result.name.toLowerCase().endsWith('.mov') && <video aria-label={t('app.editor.export.previewLabel')} src={result.url} controls playsInline preload="metadata" className="max-h-56 w-full rounded-lg bg-black" />}
    <p role="status"><a className="inline-flex items-center rounded-full bg-vx-accent px-4 py-2 text-xs font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover" href={result.url} download={result.name}>{t('app.editor.export.download', { name: result.name })}</a></p>
    <p className="text-xs text-vx-fg-muted">{t('app.editor.export.savedWhere')}</p>
    <EditorDeliveryPanel result={result} />
    {onDone && <Button size="sm" variant="ghost" onClick={onDone}>{t('app.editor.export.done')}</Button>}
  </section>;
}
