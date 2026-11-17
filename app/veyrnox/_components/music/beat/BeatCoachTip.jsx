'use client';
import { useI18n } from '../../../../../components/I18nProvider';
import { BEAT_TIP_STEPS } from '../../../_lib/music/beat/beatCoachMarks.mjs';
import { action, button } from './beatStyles';
export default function BeatCoachTip({ step, primary, onNext, onSkip }) {
  const { t } = useI18n();
  return <>
    <div aria-hidden="true" className="pointer-events-none fixed z-40 rounded-xl border-2 border-vx-accent motion-reduce:animate-none" style={{ top: step.box.top, left: step.box.left, width: step.box.width, height: step.box.height }} />
    <section aria-label={t('app.music.beat.tips')} className={`fixed inset-x-4 z-40 mx-auto flex max-h-[50dvh] max-w-md flex-col rounded-2xl border border-vx-accent bg-vx-panel p-4 text-vx-fg ${step.box.top > (globalThis.innerHeight || 700) / 2 ? 'top-4' : 'bottom-4'}`}>
      <p className="min-h-0 overflow-y-auto break-words" role="status" aria-atomic="true">{t(BEAT_TIP_STEPS[step.index].key)}</p>
      <div className="mt-3 flex shrink-0 flex-wrap gap-2">
        <button ref={primary} className={action} onClick={() => onNext()}>{t(step.index === BEAT_TIP_STEPS.length - 1 ? 'app.music.beat.done' : 'app.music.beat.next')}</button>
        <button className={button} onClick={() => onSkip()}>{t('app.music.beat.skip')}</button>
      </div>
    </section>
  </>;
}
