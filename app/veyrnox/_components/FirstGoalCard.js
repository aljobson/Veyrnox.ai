'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../components/I18nProvider';
import { FIRST_GOALS, FIRST_GOAL_EXAMPLES, FIRST_GOAL_SLOT, firstGoalTarget, parseFirstGoal, serializeFirstGoal } from '../_lib/firstGoal';
import { fetchRemoteFirstGoal, pushFirstGoal } from '../_lib/firstGoalSync';

function readStored() {
  try { return parseFirstGoal(window.localStorage.getItem(FIRST_GOAL_SLOT)); } catch { return null; }
}

// This browser's copy, plus the account's own (when the server has the feature on and someone is signed in).
function store(goal) {
  try { window.localStorage.setItem(FIRST_GOAL_SLOT, serializeFirstGoal(goal)); } catch { /* storage blocked: it may be asked once more */ }
  void pushFirstGoal(goal);
}

const noSubscribe = () => () => {};

// One question, once per browser, skippable. Creation goals stay here and filter the models; Edit and Publish route to
// their own area. "Not sure" lists one example per area. After a creation goal the card offers one example prompt, like the "Surprise me" chip competitors use.
export function FirstGoalCard({ hidden, onPick, onExample }) {
  const { t } = useI18n();
  const router = useRouter();
  // Server and first client render say 'checking' (nothing shown); the browser then reads its own stored answer.
  const device = useSyncExternalStore(noSubscribe, () => (readStored() ? 'done' : 'ask'), () => 'checking');
  // The account's own answer wins when the server has one (so a second device, or a second account in this browser, is
  // right); only when it cannot be asked does this browser's copy decide.
  const [remote, setRemote] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchRemoteFirstGoal().then((answer) => {
      if (!alive) return;
      if (answer.kind === 'goal') { try { window.localStorage.setItem(FIRST_GOAL_SLOT, serializeFirstGoal(answer.goal)); } catch { /* ignore */ } }
      setRemote(answer);
    });
    return () => { alive = false; };
  }, []);
  const [local, setState] = useState(null); // ask | example | done, once the person has acted
  const resolved = device === 'checking' || remote === null ? 'checking' : remote.kind === 'goal' ? 'done' : remote.kind === 'none' ? 'ask' : device;
  const state = local ?? resolved;
  const [chosen, setChosen] = useState(null);

  if (hidden || state === 'checking' || state === 'done') return null;

  function choose(goal) {
    store(goal);
    if (goal === 'unsure') { onPick('all'); setState('examples'); return; }
    const target = firstGoalTarget(goal);
    if (target.href) { router.push(target.href); return; }
    onPick(target.createGoal);
    if (['image', 'video', 'audio'].includes(goal)) { setChosen(goal); setState('example'); } else setState('done');
  }

  if (state === 'examples') {
    return (
      <div data-testid="first-goal-examples" className="rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-5">
        <h2 className="text-lg font-extrabold text-vx-fg">{t('app.create.firstGoal.title')}</h2>
        <div className="mt-3 flex flex-col gap-2">
          {FIRST_GOAL_EXAMPLES.map((goal) => (
            <button
              key={goal}
              type="button"
              data-testid={`first-goal-example-${goal}`}
              onClick={() => { store(goal); onPick(goal); onExample(t(`app.create.firstGoal.example.${goal}`)); setState('done'); }}
              className="min-h-11 rounded-xl border border-vx-border px-3 py-2 text-start transition-colors hover:border-vx-fg-muted"
            >
              <span className="block text-sm font-bold text-vx-fg">{tOr(t, `app.create.firstGoal.${goal}`, goal)}</span>
              <span className="mt-0.5 block text-xs text-vx-fg-muted">{t(`app.create.firstGoal.example.${goal}`)}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => { store('skipped'); setState('done'); }} className="mt-3 min-h-11 text-sm font-bold text-vx-fg-muted hover:text-vx-fg">
          {t('app.create.firstGoal.skip')}
        </button>
      </div>
    );
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
