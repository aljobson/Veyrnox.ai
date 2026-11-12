import Link from 'next/link';
import { AssetFooter } from './AssetFooter';
import { AssetLoadStatus } from './AssetLoadStatus';
import { Chip } from './Chip';
import { ScheduleGeneration } from './ScheduleGeneration';
import { SaveToAudioShelfButton } from './SaveToAudioShelfButton';
import { useAssetUrl } from '../_lib/useAssetUrl';
import { libraryEditorHref } from '../_lib/editorMedia.mjs';
import { useEditorEnabled } from './EditorFlag';
import { useI18n } from '../../../components/I18nProvider';

// Account list is authoritative; local history supplies cached display names.
const STATE_UI = {
  queued:    { chip: 'accent', glyph: '●', label: 'QUEUED' },
  running:   { chip: 'accent', glyph: '●', label: 'RUNNING' },
  succeeded: { chip: 'accent', glyph: '✓', label: 'DONE' },
  // FAILED is not REFUNDED: the refund is a second call, and /jobs/:id says
  // whether it has landed. Claiming it either way was the old bug.
  failed:    { chip: 'danger', glyph: '✕', label: 'FAILED · REFUNDED' },
  failed_pending: { chip: 'danger', glyph: '✕', label: 'FAILED · REFUND PENDING' },
  // We could not read this job's state: it 404s (not ours, or aged out of the
  // window) or the server was unreachable. Deliberately neutral — claiming
  // either DONE or FAILED · REFUNDED would assert something about the ledger
  // that we have not checked.
  unknown:   { chip: 'neutral', glyph: '?', label: 'UNKNOWN' },
};

export function LibraryJobCard({ row, models, selectable, selected, onToggle, starred, onStar }) {
  const asset = useAssetUrl(row.job_id, row.asset_url);
  const { t } = useI18n();
  const editorEnabled = useEditorEnabled();
  const refundPending = row.state === 'failed' && row.refunded !== true;
  const s = STATE_UI[refundPending ? 'failed_pending' : row.state] || STATE_UI.queued;
  // No delta for `unknown`: a +N would claim a refund landed and a −N would
  // claim the debit stands, and we do not know which.
  // No delta while a refund is owed but not yet made: +N would claim it landed.
  // A job that used a free allowance (ADR-0069) has credits 0: say FREE, and show nothing if it failed
  // (its allowance went back, there is no refund line to claim).
  const free = row.credits === 0;
  const delta = row.state === 'unknown' || refundPending ? ''
    : free ? (row.state === 'failed' ? '' : 'FREE')
    : row.state === 'failed' ? `+${row.credits}` : `−${row.credits}`;
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

  return (
    <div className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
      <div
        className={`h-48 relative ${row.state === 'running' ? 'vx-shimmer' : ''}`}
        style={{ background: row.asset_url ? 'black' : row.bg }}
      >
        {row.asset_url && row.mime_type?.startsWith('video/') && (
          <video src={asset.url} onError={asset.onError} onLoadedData={asset.onLoad} className="absolute inset-0 w-full h-full object-cover" muted playsInline autoPlay loop />
        )}
        {row.asset_url && row.mime_type?.startsWith('audio/') && (
          <div className="absolute inset-0 flex items-end px-4 pb-4">
            <audio src={asset.url} onError={asset.onError} onLoadedData={asset.onLoad} controls className="w-full" />
          </div>
        )}
        {row.asset_url && row.mime_type?.startsWith('image/') && (
          <img src={asset.url} onError={asset.onError} onLoad={asset.onLoad} alt={row.name || 'generation'} className="absolute inset-0 w-full h-full object-cover" />
        )}
        <AssetLoadStatus asset={asset} />
        <div className="absolute top-3 left-3">
          <Chip tone={s.chip} noGlyph>
            <span aria-hidden="true" className="text-[10px] mr-1">{s.glyph}</span>
            <span data-library-status={refundPending ? 'failed_pending' : row.state}>{s.label}</span>
          </Chip>
        </div>
        {row.asset_url && (
          // Disclosure on every generated asset (ADR-0058 decision 8; provider
          // GenAI policies and EU AI Act Article 50 both ask for it).
          <div className={`absolute top-3 ${selectable ? 'right-14' : 'right-3'}`}>
            <Chip tone="neutral" noGlyph className="bg-black/50">AI generated</Chip>
          </div>
        )}
        {selectable && (
          <button onClick={onToggle} aria-pressed={selected} aria-label={selected ? 'Remove from edit' : 'Add to edit'}
            className={`absolute top-3 right-3 w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold ${
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
            {row.submitted_at ? ` · ${formatWhen(row.submitted_at)}` : ''}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <span className={`font-vx-mono text-[13px] font-bold vx-num ${deltaCls}`}>{delta}{free ? '' : ' cr'}</span>
          <button onClick={onStar} aria-pressed={starred} data-testid="library-favourite" aria-label={starred ? 'Remove from favourites' : 'Add to favourites'} type="button"
            className={`text-[18px] leading-none ${starred ? 'text-vx-accent' : 'text-vx-fg-faint hover:text-vx-fg'}`}>
            {starred ? '★' : '☆'}
          </button>
        </div>
      </div>
      <ScheduleGeneration job={row} className="mx-4 mb-3" />
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

function formatWhen(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
