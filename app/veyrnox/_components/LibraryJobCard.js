import Link from 'next/link';
import { useRef } from 'react';
import { AssetFooter } from './AssetFooter';
import { AssetLoadStatus } from './AssetLoadStatus';
import { Chip } from './Chip';
import { LibraryClip } from './LibraryClip';
import { ScheduleGeneration } from './ScheduleGeneration';
import { SaveToAudioShelfButton } from './SaveToAudioShelfButton';
import { useI18n } from '../../../components/I18nProvider';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { formatWhen } from '../_lib/formatWhen';
import { useAssetUrl } from '../_lib/useAssetUrl';
import { libraryEditorHref } from '../_lib/editorMedia.mjs';
import { useEditorEnabled } from './EditorFlag';

// Account list is authoritative; local history supplies cached display names.
const STATE_UI = {
  queued:    { chip: 'accent', glyph: '●' },
  running:   { chip: 'accent', glyph: '●' },
  succeeded: { chip: 'accent', glyph: '✓' },
  // FAILED is not REFUNDED: the refund is a second call, and /jobs/:id says
  // whether it has landed. Claiming it either way was the old bug.
  failed:    { chip: 'danger', glyph: '✕' },
  failed_pending: { chip: 'danger', glyph: '✕' },
  // We could not read this job's state: it 404s (not ours, or aged out of the
  // window) or the server was unreachable. Deliberately neutral — claiming
  // either DONE or FAILED · REFUNDED would assert something about the ledger
  // that we have not checked.
  unknown:   { chip: 'neutral', glyph: '?' },
};

export function LibraryJobCard({ row, models, selectable, selected, onToggle, starred, onStar, onSmartCut }) {
  const asset = useAssetUrl(row.job_id, row.asset_url);
  const { t, locale } = useI18n();
  const editorEnabled = useEditorEnabled();
  const refundPending = row.state === 'failed' && row.refunded !== true;
  const s = STATE_UI[refundPending ? 'failed_pending' : row.state] || STATE_UI.queued;
  // No delta for `unknown`: a +N would claim a refund landed and a −N would
  // claim the debit stands, and we do not know which.
  // No delta while a refund is owed but not yet made: +N would claim it landed.
  // A job that used a free allowance (ADR-0069) has credits 0: say FREE, and show nothing if it failed
  // (its allowance went back, there is no refund line to claim).
  const free = row.credits === 0;
  const creditCount = locale === 'en' ? row.credits : Number(row.credits).toLocaleString(localeTag(locale));
  const delta = row.state === 'unknown' || refundPending ? ''
    : free ? (row.state === 'failed' ? '' : t('app.library.free'))
    : row.state === 'failed' ? `+${creditCount}` : `−${creditCount}`;
  const deltaCls = free || row.state === 'failed' ? 'text-vx-accent' : 'text-vx-fg-muted';
  // Live catalog (tokens.js fallback) so newly added models show their name.
  const model = models.find((m) => m.id === row.model_id);
  // The full editor takes a finished video or audio result straight from the Library, where the editor is switched on.
  const editHref = libraryEditorHref(row, model?.name);
  const shelfPurpose = row.model_id === 'elevenlabs-dialogue'
    ? 'lip-sync-dialogue'
    : row.model_id === 'minimax-speech-2.6-hd'
      ? 'narration-presenter'
      : 'timing-rhythm';
  // The whole card: hover or focus anywhere on it plays its clip (LibraryClip).
  const card = useRef(null);

  return (
    <div ref={card} className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
      <div
        className={`h-48 relative ${row.state === 'running' ? 'vx-shimmer' : ''}`}
        style={{ background: row.asset_url ? 'black' : row.bg }}
      >
        {row.asset_url && row.mime_type?.startsWith('video/') && (
          <LibraryClip cardRef={card} src={asset.url} onError={asset.onError} onLoadedData={asset.onLoad} />
        )}
        {row.asset_url && row.mime_type?.startsWith('audio/') && (
          <div className="absolute inset-0 flex items-end px-4 pb-4">
            <audio src={asset.url} onError={asset.onError} onLoadedData={asset.onLoad} controls className="w-full" />
          </div>
        )}
        {row.asset_url && row.mime_type?.startsWith('image/') && (
          <img loading="lazy" decoding="async" src={asset.url} onError={asset.onError} onLoad={asset.onLoad} alt={row.name || t("app.library.generation")} className="absolute inset-0 w-full h-full object-cover" />
        )}
        <AssetLoadStatus asset={asset} />
        <div className="absolute top-3 start-3">
          <Chip tone={s.chip} noGlyph>
            <span aria-hidden="true" className="text-[10px] me-1">{s.glyph}</span>
            <span data-library-status={refundPending ? 'failed_pending' : row.state}>{tOr(t, `app.library.status.${refundPending ? 'failed_pending' : row.state}`, t('app.library.status.queued'))}</span>
          </Chip>
        </div>
        {row.asset_url && (
          // Disclosure on every generated asset (ADR-0058 decision 8; provider
          // GenAI policies and EU AI Act Article 50 both ask for it).
          <div className={`absolute top-3 ${selectable ? 'end-14' : 'end-3'}`}>
            <Chip tone="neutral" noGlyph className="bg-black/50">{t("app.library.generated")}</Chip>
          </div>
        )}
        {selectable && (
          <button onClick={onToggle} aria-pressed={selected} data-testid="library-add-to-edit" aria-label={t("app.library.addToEdit")} type="button"
            className={`absolute top-3 end-3 w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold ${
              selected ? 'bg-vx-accent border-vx-accent text-vx-accent-ink' : 'bg-black/50 border-white/70 text-transparent'
            }`}>
            ✓
          </button>
        )}
      </div>
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold truncate">{row.name || row.prompt || row.job_id.slice(0, 8)}</div>
          <div className="text-xs text-vx-fg-muted mt-0.5 truncate">
            {model?.name || row.model_id}
            {row.submitted_at ? ` · ${formatWhen(row.submitted_at, locale)}` : ''}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <span dir="ltr" className={`font-vx-mono text-[13px] font-bold vx-num ${deltaCls}`}>{delta}{free || !delta ? '' : ' cr'}</span>
          <button onClick={onStar} aria-pressed={starred} data-testid="library-favourite" aria-label={t("app.library.favourite")} type="button"
            className={`text-[18px] leading-none ${starred ? 'text-vx-accent' : 'text-vx-fg-faint hover:text-vx-fg'}`}>
            {starred ? '★' : '☆'}
          </button>
        </div>
      </div>
      <ScheduleGeneration job={row} className="mx-4 mb-3" />
      {selectable && onSmartCut && row.mime_type?.startsWith('video/') && (
        <div className="mx-4 mb-3">
          <button type="button" onClick={onSmartCut} data-testid="library-smart-cut"
            className="inline-flex min-h-10 w-full items-center justify-center rounded-full border border-vx-border px-4 text-xs font-extrabold hover:border-vx-accent">
            {t('app.library.smartCutThis')}
          </button>
        </div>
      )}
      {row.state === 'succeeded' && row.asset_url && row.mime_type?.startsWith('audio/') && (
        <div className="mx-4 mb-3">
          <SaveToAudioShelfButton
            jobId={row.job_id}
            name={`Library · ${model?.name || 'Owned audio'}`}
            purpose={shelfPurpose}
            className="inline-flex min-h-10 w-full items-center justify-center rounded-full border border-vx-border px-4 text-xs font-extrabold disabled:opacity-60"
          />
        </div>
      )}
      {editorEnabled && editHref && (
        <div className="mx-4 mb-3">
          <Link href={editHref} data-testid="library-open-editor"
            className="inline-flex min-h-10 w-full items-center justify-center rounded-full border border-vx-border px-4 text-xs font-extrabold hover:border-vx-fg-muted">
            {t('app.library.openInEditor')}
          </Link>
        </div>
      )}
      <AssetFooter row={row} />
    </div>
  );
}
