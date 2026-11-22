'use client';

import { MusicPrivateAudio } from '../../_lib/useMusicAudioSrc';
import { useI18n } from '../../../../components/I18nProvider';

export function MusicServerCandidate({ candidate, title }) {
  const { t } = useI18n();
  const label = candidate.label || (candidate.ordinal === 2 ? 'B' : 'A');
  const state = candidate.state || 'queued';
  const stateLabel = t(`app.music.suno.state.${state}`);
  return (
    <article data-testid={`music-candidate-${label.toLowerCase()}`} data-status={state} className="rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">{t('app.music.suno.version', { label })}</p><h3 className="mt-1 font-vx text-xl font-black">{title || t('app.music.suno.privateDraft', { label })}</h3></div>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${state === 'ready' ? 'border-vx-accent/50 text-vx-accent' : state === 'refunded' || state === 'failed' ? 'border-vx-danger/50 text-vx-danger' : 'border-vx-border text-vx-fg-muted'}`}>{stateLabel}</span>
      </div>
      {state === 'running' || state === 'queued' ? <div className="mt-5" aria-label={t('app.music.suno.versionStatus', { label, status: stateLabel })} aria-busy="true"><div className="vx-shimmer h-2 rounded-full bg-vx-base"/><p className="mt-3 text-sm text-vx-fg-muted">{t('app.music.suno.candidateIndependent')}</p></div> : null}
      {state === 'ready' && candidate.audio_url ? <MusicPrivateAudio className="mt-5 w-full" controls preload="none" src={candidate.audio_url} aria-label={t('app.music.suno.playVersion', { label })} /> : null}
      {state === 'refunded' ? <p className="mt-4 text-sm text-vx-fg-body">{t('app.music.suno.candidateRefunded')}</p> : null}
      {state === 'failed' ? <p className="mt-4 text-sm text-vx-fg-body">{t('app.music.suno.candidateFailed')}</p> : null}
    </article>
  );
}
