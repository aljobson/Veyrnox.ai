'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../components/I18nProvider';
import { FIRST_GOALS, firstGoalTarget } from '../_lib/firstGoal';
import { FIRST_DESTINATIONS, FIRST_ROLES, needsFirstRun } from '../_lib/firstProfile';
import { pushOnboarding, saveDeviceAnswers, saveDeviceOnboarding, setFirstRunHandoff } from '../_lib/firstProfileSync';
import { useFirstProfile } from '../_lib/useFirstProfile';
import { signalVeyMood } from '../../../lib/veyMood';
import { getStoredUserId } from '../../lib/authClient';

const STEPS = ['goal', 'destination', 'role'];

// The first-run questions (ADR-0339): what to make first, where it will go, which describes you best. One per screen,
// each skippable and resumed from the account's versioned step. It sits inside the age gate, so it never comes before it.
// Every answer is one fixed word, saved on this device and (when the account copy is on) the account.
export function FirstRunFlow() {
  const { t } = useI18n();
  const router = useRouter();
  const profile = useFirstProfile();
  const [closed, setClosed] = useState(false);
  const [step, setStep] = useState(0);
  const answers = useRef({});
  const heading = useRef(null);
  const hydratedFor = useRef(null);

  // The answers on record only change when the session does, so "is it needed" is read straight off them.
  const open = !closed && profile.ready && profile.signedIn && needsFirstRun(profile);
  useEffect(() => {
    setClosed(false);
    hydratedFor.current = null;
  }, [profile.userId]);
  useEffect(() => {
    if (!open || hydratedFor.current === profile.userId) return;
    hydratedFor.current = profile.userId;
    answers.current = { goal: profile.goal, role: profile.role, destination: profile.destination };
    const next = profile.currentStep === 'recap' ? STEPS.length : Math.max(0, STEPS.indexOf(profile.currentStep));
    setStep(next);
  }, [open, profile.currentStep, profile.destination, profile.goal, profile.role, profile.userId]);
  useEffect(() => { if (open) heading.current?.focus(); }, [open, step]);
  useEffect(() => { if (open && step === 0) signalVeyMood('first-sign-in', 9000); }, [open, step]);

  async function finish() {
    const owner = profile.userId;
    if (owner && step >= STEPS.length) {
      const result = await pushOnboarding({ currentStep: 'recap', completed: true }, undefined, owner);
      if (getStoredUserId() !== owner) return;
      if (result?.version !== undefined) saveDeviceOnboarding(owner, {
        goal: result.goal, role: result.role, destination: result.destination, version: result.version,
        currentStep: result.current_step, completed: result.completed,
      });
    }
    if (getStoredUserId() !== owner) return;
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
    const owner = profile.userId;
    const key = STEPS[step];
    answers.current = { ...answers.current, [key]: word };
    saveDeviceAnswers({ [key]: word });
    const nextStep = step < STEPS.length - 1 ? STEPS[step + 1] : answers.current.goal === 'skipped' ? null : 'recap';
    const completed = step === STEPS.length - 1 && answers.current.goal === 'skipped';
    if (owner) saveDeviceOnboarding(owner, { ...answers.current, version: 1, currentStep: nextStep, completed });
    void pushOnboarding({ currentStep: key, answer: word }, undefined, owner).then((result) => {
      if (result?.version !== undefined && owner && getStoredUserId() === owner) saveDeviceOnboarding(owner, {
        goal: result.goal, role: result.role, destination: result.destination, version: result.version,
        currentStep: result.current_step, completed: result.completed,
      });
    });
    if (step < STEPS.length - 1) setStep(step + 1);
    else if (answers.current.goal === 'skipped') void finish();
    else setStep(STEPS.length);
  }

  if (!open) return null;
  if (step >= STEPS.length) return (
    <div role="dialog" aria-modal="true" aria-label={t('app.create.firstRun.label')} data-testid="first-run-flow"
      onKeyDown={(event) => { if (event.key === 'Escape') setClosed(true); }}
      className="vx-overlay vx-overlay-sheet fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="w-full max-w-[460px] rounded-[20px] border border-vx-border bg-vx-panel p-6 shadow-2xl">
        <h2 ref={heading} tabIndex={-1} data-testid="first-run-title" className="vx-display text-balance text-[28px] outline-none">{t('app.create.firstRun.suggested')}</h2>
        <p className="mt-3 text-sm text-vx-fg-muted">{t('app.create.firstRun.personalise')}</p>
        <button type="button" data-testid="first-run-continue" onClick={() => { void finish(); }}
          className="mt-6 min-h-12 w-full rounded-xl bg-vx-accent px-4 py-3 text-sm font-bold text-black vx-press">
          {t('app.age.continue')}
        </button>
      </div>
    </div>
  );
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
      onKeyDown={(event) => { if (event.key === 'Escape') setClosed(true); }}
      className="vx-overlay vx-overlay-sheet fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
    >
      <div className="w-full max-w-[460px] rounded-[20px] border border-vx-border bg-vx-panel p-6 shadow-2xl">
        <h2 key={`title-${key}`} ref={heading} tabIndex={-1} data-testid="first-run-title" className="vx-fade-in vx-display text-balance text-[28px] outline-none">{title}</h2>
        <p className="mt-2 text-sm text-vx-fg-muted">{t('app.create.firstRun.personalise')}</p>
        <div key={`options-${key}`} className="vx-fade-in mt-5 grid gap-2" role="group" aria-label={title}>
          {options.map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`first-run-${key}-${id}`}
              onClick={() => answer(id)}
              className="min-h-12 rounded-xl border border-vx-border px-4 py-3 text-start text-sm font-bold text-vx-fg-body vx-press hover:border-vx-accent hover:text-vx-fg focus-visible:outline-2 focus-visible:outline-vx-accent"
            >
              {label(id)}
            </button>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between">
          <div aria-hidden="true" className="flex gap-2">
            {STEPS.map((name, index) => (
              <span key={name} className={`h-2 w-2 rounded-full transition-colors duration-200 ${index === step ? 'bg-vx-accent' : 'bg-vx-border'}`} />
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
