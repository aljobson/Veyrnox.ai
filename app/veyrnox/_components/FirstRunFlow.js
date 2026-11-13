'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../components/I18nProvider';
import { FIRST_GOALS, firstGoalTarget } from '../_lib/firstGoal';
import { FIRST_DESTINATIONS, FIRST_ROLES, needsFirstRun } from '../_lib/firstProfile';
import { pushAnswers, saveDeviceAnswers, setFirstRunHandoff } from '../_lib/firstProfileSync';
import { useFirstProfile } from '../_lib/useFirstProfile';

const STEPS = ['role', 'goal', 'destination'];

// The first-run questions (ADR-0339): which describes you best, what to make first, where it will go. One per screen,
// each skippable, asked once of someone with no goal and no role on record. It sits inside the age gate, so it never
// comes before it. Every answer is one fixed word, saved on this device and (when the account copy is on) the account.
export function FirstRunFlow() {
  const { t } = useI18n();
  const router = useRouter();
  const profile = useFirstProfile();
  const [closed, setClosed] = useState(false);
  const [step, setStep] = useState(0);
  const answers = useRef({});
  const heading = useRef(null);

  // The answers on record only change when the session does, so "is it needed" is read straight off them.
  const open = !closed && profile.ready && profile.signedIn && needsFirstRun(profile);
  useEffect(() => { if (open) heading.current?.focus(); }, [open, step]);

  function finish() {
    setClosed(true);
    const goal = answers.current.goal;
    const target = goal ? firstGoalTarget(goal) : null;
    if (target?.href) router.push(target.href);
    else if (target?.createGoal === 'image' || target?.createGoal === 'video' || target?.createGoal === 'audio') {
      setFirstRunHandoff(target.createGoal);
      router.push('/app/create');
    }
  }

  function answer(word) {
    const key = STEPS[step];
    answers.current = { ...answers.current, [key]: word };
    saveDeviceAnswers({ [key]: word });
    void pushAnswers({ [key]: word });
    if (step < STEPS.length - 1) setStep(step + 1);
    else finish();
  }

  // Escape is "skip the rest": whatever is left is recorded as skipped so nobody is asked again.
  function skipRest() {
    for (const key of STEPS.slice(step)) {
      answers.current = { ...answers.current, [key]: 'skipped' };
      saveDeviceAnswers({ [key]: 'skipped' });
    }
    void pushAnswers(answers.current);
    setClosed(true);
  }

  if (!open) return null;
  const key = STEPS[step];
  const options = key === 'role' ? FIRST_ROLES : key === 'goal' ? FIRST_GOALS.map(({ id }) => id) : FIRST_DESTINATIONS;
  const title = key === 'role' ? t('app.create.firstRun.roleTitle') : key === 'goal' ? t('app.create.firstGoal.title') : t('app.create.firstRun.destTitle');
  const label = (id) => (key === 'role' ? t(`app.create.firstRun.role.${id}`) : key === 'goal' ? tOr(t, `app.create.firstGoal.${id}`, id) : t(`app.create.firstRun.dest.${id}`));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('app.create.firstRun.label')}
      data-testid="first-run-flow"
      onKeyDown={(event) => { if (event.key === 'Escape') skipRest(); }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
    >
      <div className="w-full max-w-[460px] rounded-[20px] border border-vx-border bg-vx-panel p-6 shadow-2xl">
        <h2 ref={heading} tabIndex={-1} data-testid="first-run-title" className="vx-display text-balance text-[28px] outline-none">{title}</h2>
        <p className="mt-2 text-sm text-vx-fg-muted">{t('app.create.firstRun.personalise')}</p>
        <div className="mt-5 grid gap-2" role="group" aria-label={title}>
          {options.map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`first-run-${key}-${id}`}
              onClick={() => answer(id)}
              className="min-h-12 rounded-xl border border-vx-border px-4 py-3 text-start text-sm font-bold text-vx-fg-body transition-colors hover:border-vx-accent hover:text-vx-fg focus-visible:outline-2 focus-visible:outline-vx-accent"
            >
              {label(id)}
            </button>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between">
          <div aria-hidden="true" className="flex gap-2">
            {STEPS.map((name, index) => (
              <span key={name} className={`h-2 w-2 rounded-full ${index === step ? 'bg-vx-accent' : 'bg-vx-border'}`} />
            ))}
          </div>
          <button type="button" data-testid="first-run-skip" onClick={() => answer('skipped')} className="min-h-11 px-3 text-sm font-bold text-vx-fg-muted hover:text-vx-fg">
            {t('app.create.firstGoal.skip')}
          </button>
        </div>
      </div>
    </div>
  );
}
