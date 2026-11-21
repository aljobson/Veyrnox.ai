'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../components/I18nProvider';
import { FIRST_GOALS, firstGoalTarget } from '../_lib/firstGoal';
import { FIRST_DESTINATIONS, FIRST_ROLES, exampleSetFor, needsFirstRun } from '../_lib/firstProfile';
import { dismissFirstRun, isFirstRunDismissed, saveDeviceAnswers, saveDeviceOnboarding, scheduleOnboardingReplay, setFirstRunHandoff } from '../_lib/firstProfileSync';
import { useFirstProfile } from '../_lib/useFirstProfile';
import { useTemplateCards } from '../_lib/useTemplates';
import { signalVeyMood } from '../../../lib/veyMood';
import { getStoredUserId } from '../../lib/authClient';
import { captureProductEvent } from '../../lib/analyticsClient';

const STEPS = ['goal', 'destination', 'role'];

function FirstRunRecap({ answers, heading, onContinue, onDismiss }) {
  const { t } = useI18n();
  const cards = useTemplateCards().templates;
  const goal = ['image', 'video', 'audio'].includes(answers.goal) ? answers.goal : 'image';
  const sample = cards.find((card) => goal === 'image' ? card.kind === 'image' && card.previewImage : card.kind !== 'image' && card.clip?.poster)
    ?? cards.find((card) => card.previewImage || card.clip?.poster);
  const sampleUrl = sample?.clip?.poster ?? sample?.previewImage ?? null;
  const ideaKey = exampleSetFor(answers.role) === 'work' ? `app.create.firstRun.example.work.${goal}` : `app.create.firstGoal.example.${goal}`;
  const chips = [
    answers.goal && answers.goal !== 'skipped' ? tOr(t, `app.create.firstGoal.${answers.goal}`, answers.goal) : null,
    answers.destination && answers.destination !== 'skipped' ? t(`app.create.firstRun.dest.${answers.destination}`) : null,
    answers.role && answers.role !== 'skipped' ? t(`app.create.firstRun.role.${answers.role}`) : null,
  ].filter(Boolean);
  return (
    <div role="dialog" aria-modal="true" aria-label={t('app.create.firstRun.label')} data-testid="first-run-flow"
      onKeyDown={(event) => { if (event.key === 'Escape') onDismiss(); }}
      className="vx-overlay vx-overlay-sheet fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="w-full max-w-[520px] rounded-[20px] border border-vx-border bg-vx-panel p-6 shadow-2xl">
        {sampleUrl && <div data-testid="first-run-sample" className="relative mb-5 aspect-video overflow-hidden rounded-2xl bg-vx-base"><Image src={sampleUrl} alt="" fill sizes="520px" className="object-cover" /></div>}
        <h2 ref={heading} tabIndex={-1} data-testid="first-run-title" className="vx-display text-balance text-[28px] outline-none">{t('app.create.firstRun.suggested')}</h2>
        <p data-testid="first-run-idea" className="mt-3 rounded-xl bg-vx-base p-4 text-sm font-bold text-vx-fg-body">{t(ideaKey)}</p>
        {chips.length > 0 && <div data-testid="first-run-chips" className="mt-4 flex flex-wrap gap-2">{chips.map((chip) => <span key={chip} className="rounded-full border border-vx-border px-3 py-1.5 text-xs font-bold text-vx-fg-body">{chip}</span>)}</div>}
        <button type="button" data-testid="first-run-continue" onClick={onContinue}
          className="mt-6 min-h-12 w-full rounded-xl bg-vx-accent px-4 py-3 text-sm font-bold text-black vx-press">{t('app.age.continue')}</button>
      </div>
    </div>
  );
}

// The first-run questions (ADR-0339): what to make first, where it will go, which describes you best. One per screen,
// each skippable and resumed from the account's versioned step. It sits inside the age gate, so it never comes before it.
// Every answer is one fixed word, saved on this device and (when the account copy is on) the account.
export function FirstRunFlow() {
  const { t } = useI18n();
  const router = useRouter();
  const profile = useFirstProfile();
  const [closedFor, setClosedFor] = useState(null);
  const [step, setStep] = useState(0);
  const answers = useRef({});
  const heading = useRef(null);
  const hydratedFor = useRef(null);

  // The answers on record only change when the session does, so "is it needed" is read straight off them.
  const dismissed = !!profile.userId && (closedFor === profile.userId || isFirstRunDismissed(profile.userId));
  const open = !dismissed && !profile.unresolved && profile.ready && profile.signedIn && needsFirstRun(profile);
  useEffect(() => {
    hydratedFor.current = null;
  }, [profile.userId]);
  useEffect(() => {
    if (!open || hydratedFor.current === profile.userId) return;
    hydratedFor.current = profile.userId;
    answers.current = { goal: profile.goal, role: profile.role, destination: profile.destination };
    const next = profile.currentStep === 'recap' ? STEPS.length : Math.max(0, STEPS.indexOf(profile.currentStep));
    setStep(next);
    captureProductEvent('onboarding_step', { step: 'questions', action: 'view' });
  }, [open, profile.currentStep, profile.destination, profile.goal, profile.role, profile.userId]);
  useEffect(() => { if (open) heading.current?.focus(); }, [open, step]);
  useEffect(() => { if (open && step === 0) signalVeyMood('first-sign-in', 9000); }, [open, step]);

  function dismiss() {
    dismissFirstRun(profile.userId);
    setClosedFor(profile.userId);
  }

  function finish() {
    const owner = profile.userId;
    if (owner) {
      const pending = { ...answers.current, version: 1, currentStep: answers.current.goal === 'skipped' ? 'role' : 'recap',
        completed: false, pending: true, completeRequested: true };
      saveDeviceOnboarding(owner, pending);
      void scheduleOnboardingReplay(owner, pending);
    }
    if (getStoredUserId() !== owner) return;
    setClosedFor(owner);
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
    const atEnd = step === STEPS.length - 1;
    const completeRequested = atEnd && answers.current.goal === 'skipped';
    const nextStep = step < STEPS.length - 1 ? STEPS[step + 1] : completeRequested ? 'role' : 'recap';
    const pending = { ...answers.current, version: 1, currentStep: nextStep, completed: false, pending: true, completeRequested };
    if (owner) { saveDeviceOnboarding(owner, pending); void scheduleOnboardingReplay(owner, pending); }
    captureProductEvent('onboarding_step', { step: 'questions', action: word === 'skipped' ? 'skip' : 'next' });
    if (step < STEPS.length - 1) setStep(step + 1);
    else if (answers.current.goal === 'skipped') void finish();
    else setStep(STEPS.length);
  }

  if (!open) return null;
  if (step >= STEPS.length) return <FirstRunRecap answers={answers.current} heading={heading} onDismiss={dismiss}
    onContinue={() => { captureProductEvent('onboarding_step', { step: 'recap', action: 'next' }); finish(); }} />;
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
      onKeyDown={(event) => { if (event.key === 'Escape') dismiss(); }}
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
