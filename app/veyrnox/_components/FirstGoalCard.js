'use client';
import { useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../components/I18nProvider';
import { FIRST_GOALS, FIRST_GOAL_SLOT, firstGoalTarget, parseFirstGoal, serializeFirstGoal } from '../_lib/firstGoal';

function readStored() {
  try { return parseFirstGoal(window.localStorage.getItem(FIRST_GOAL_SLOT)); } catch { return null; }
}

function store(goal) {
  try { window.localStorage.setItem(FIRST_GOAL_SLOT, serializeFirstGoal(goal)); } catch { /* storage blocked: it may be asked once more */ }
}

const noSubscribe = () => () => {};

// One question, once per browser, skippable. Creation goals stay here and filter the models; Edit and Publish route to
// their own area. After a creation goal the card offers one example prompt, like the "Surprise me" chip competitors use.
export function FirstGoalCard({ hidden, onPick, onExample }) {
  const { t } = useI18n();
  const router = useRouter();
  // Server and first client render say 'checking' (nothing shown); the browser then reads its own stored answer.
  const stored = useSyncExternalStore(noSubscribe, () => (readStored() ? 'done' : 'ask'), () => 'checking');
  const [local, setState] = useState(null); // ask | example | done, once the person has acted
  const state = local ?? stored;
  const [chosen, setChosen] = useState(null);

  if (hidden || state === 'checking' || state === 'done') return null;

  function choose(goal) {
    store(goal);
    const target = firstGoalTarget(goal);
    if (target.href) { router.push(target.href); return; }
    onPick(target.createGoal);
    if (['image', 'video', 'audio'].includes(goal)) { setChosen(goal); setState('example'); } else setState('done');
  }

  if (state === 'example') {
    return (
      <div data-testid="first-goal-example" className="rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="first-goal-use-example"
            onClick={() => { onExample(t(`app.create.firstGoal.example.${chosen}`)); setState('done'); }}
            className="min-h-11 rounded-full bg-vx-accent px-4 py-2 text-sm font-extrabold text-vx-accent-ink"
          >
            {t('app.create.firstGoal.tryExample')}
          </button>
          <button type="button" onClick={() => setState('done')} className="min-h-11 px-3 text-sm font-bold text-vx-fg-muted hover:text-vx-fg">
            {t('app.create.firstGoal.skip')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="first-goal-card" className="rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-5">
      <h2 className="text-lg font-extrabold text-vx-fg">{t('app.create.firstGoal.title')}</h2>
      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label={t('app.create.firstGoal.title')}>
        {FIRST_GOALS.map((option) => (
          <button
            key={option.id}
            type="button"
            data-testid={`first-goal-${option.id}`}
            onClick={() => choose(option.id)}
            className="min-h-11 rounded-xl border border-vx-border px-3 py-2 text-start text-sm font-bold text-vx-fg-body transition-colors hover:border-vx-fg-muted hover:text-vx-fg"
          >
            {tOr(t, `app.create.firstGoal.${option.id}`, option.label)}
          </button>
        ))}
      </div>
      <button
        type="button"
        data-testid="first-goal-skip"
        onClick={() => { store('skipped'); setState('done'); }}
        className="mt-3 min-h-11 text-sm font-bold text-vx-fg-muted hover:text-vx-fg"
      >
        {t('app.create.firstGoal.skip')}
      </button>
    </div>
  );
}
