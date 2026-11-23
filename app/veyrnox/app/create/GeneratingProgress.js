'use client';
import { useReducedMotion } from 'motion/react';
import VeyCharacter from '../../_components/VeyCharacter';
import { useGenerationProgress, useInlineProgress, ProgressMeter } from '../../_components/GenerationStatusBar';

const pad = (value) => String(value).padStart(2, '0');

// The progress belongs to the generation it describes: the clock and the bar sit in this card, and the floating
// bar leaves this job out, so one reading is never on the screen twice. Until there is a reading, this is the old "…".
export function GeneratingProgress({ jobId }) {
  const reduced = useReducedMotion();
  const progress = useGenerationProgress(jobId);
  useInlineProgress(jobId);
  const seconds = progress ? Math.floor(progress.elapsedMs / 1000) : 0;
  return (
    <>
      <div className="mt-2 flex items-center justify-center gap-3">
        {/* Beside the figure, at its height: the canvas can be 180px tall, with no room above it.
            The helper's own shadow is sized for the full-height mascot. */}
        <div aria-hidden="true" className="w-10 shrink-0 [&>svg]:drop-shadow-none">
          <VeyCharacter pose="thinking" mood="patient" reducedMotion={reduced !== false} />
        </div>
        {/* The bar below announces the percent; a bare "02:15" read aloud adds nothing. */}
        <div aria-hidden="true" className="font-vx-mono text-[42px] font-bold leading-none vx-num">{progress ? `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}` : '…'}</div>
      </div>
      {progress && <div className="flex justify-center"><ProgressMeter percent={progress.percent} /></div>}
    </>
  );
}
