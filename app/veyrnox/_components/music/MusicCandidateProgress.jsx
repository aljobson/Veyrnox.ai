'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { estimatePercent, expectedDurationMs } from '../../_lib/generationProgress';

// A running music candidate: a real bar with a percentage and the patience
// line, in place of a shimmer. Same estimate as the page-wide status bar
// (time against the model's usual time, capped until the job settles). The
// song API gives no start time, so the clock starts when this card appears; a
// reload restarts the estimate, never moves it past the cap.
const TICK_MS = 1000;

export function MusicCandidateProgress({ label, modelId = 'ace-step-1.5' }) {
  const { t } = useI18n();
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const percent = estimatePercent(now - startedAt, expectedDurationMs(modelId));
  return (
    <div className="mt-5" data-testid={`music-candidate-progress-${String(label).toLowerCase()}`}>
      <p role="status" className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-accent">
        <span className="uppercase">{t('public.jobs.progress.title')}</span> · {t('public.jobs.progress.patient')}
      </p>
      <div className="mt-2 flex items-baseline justify-between text-xs text-vx-fg-body">
        <span>{`Version ${label}`}</span>
        <span className="font-vx-mono tabular-nums text-vx-fg">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t('public.jobs.progress.aria', { percent })}
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-vx-border"
      >
        <div
          className="h-full rounded-full bg-vx-accent transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-3 text-sm text-vx-fg-muted">This candidate completes independently from the other version.</p>
    </div>
  );
}
