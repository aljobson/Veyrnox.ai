'use client';

import { MusicPrivateAudio } from '../../_lib/useMusicAudioSrc';
import { MusicCandidateProgress } from './MusicCandidateProgress';
import { MusicCandidateCancel } from './MusicCandidateCancel';
import { useI18n } from '../../../../components/I18nProvider';
import { pluralKey, tOr } from '../../../../lib/i18n/translate.mjs';

export function MusicServerCandidate({ candidate, title, onCancelled }) {
  const { t, locale } = useI18n();
  const label = candidate.label || (candidate.ordinal === 2 ? 'B' : 'A');
  const state = candidate.state || 'queued';
  const userCancelled = candidate.error_code === 'user_cancelled';
  const credits = candidate.credits > 0
    ? t(pluralKey(t, locale, 'app.music.suno.credits', candidate.credits), { count: candidate.credits }) : '';
  const stateLabel = userCancelled ? t('app.music.suno.cancel.state') : tOr(t, `app.music.suno.state.${state}`, state);
  return (
    <article data-testid={`music-candidate-${label.toLowerCase()}`} data-status={state} className="rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">{t('app.music.suno.version', { label })}</p><h3 className="mt-1 font-vx text-xl font-black">{title || t('app.music.suno.privateDraft', { label })}</h3></div>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${state === 'ready' ? 'border-vx-accent/50 text-vx-accent' : state === 'refunded' || state === 'failed' ? 'border-vx-danger/50 text-vx-danger' : 'border-vx-border text-vx-fg-muted'}`}>{stateLabel}</span>
      </div>
      {state === 'running' || state === 'queued' ? <div aria-label={t('app.music.suno.versionStatus', { label, status: stateLabel.toLocaleLowerCase() })} aria-busy="true"><MusicCandidateProgress label={label} /></div> : null}
      {state === 'ready' && candidate.audio_url ? <MusicPrivateAudio className="mt-5 w-full" controls preload="none" src={candidate.audio_url} aria-label={t('app.music.suno.playVersion', { label })} /> : null}
      {state === 'refunded' ? <p role={userCancelled ? 'status' : undefined} className="mt-4 text-sm text-vx-fg-body">{userCancelled
        ? t(candidate.credits > 0 ? 'app.music.suno.cancel.cancelledPaidFormatted' : candidate.credits === 0 ? 'app.music.suno.cancel.cancelledFree' : 'app.music.suno.cancel.cancelled', { count: candidate.credits, credits })
        : t(candidate.credits > 0 ? 'app.music.suno.candidateRefundedPaid' : candidate.credits === 0 ? 'app.music.suno.candidateRefundedFree' : 'app.music.suno.candidateRefunded')}</p> : null}
      {state === 'failed' ? <p className="mt-4 text-sm text-vx-fg-body">{t('app.music.suno.candidateFailed')}</p> : null}
      {onCancelled ? <MusicCandidateCancel candidate={candidate} onCancelled={onCancelled} /> : null}
    </article>
  );
}
