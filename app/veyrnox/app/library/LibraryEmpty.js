'use client';
import Link from 'next/link';
import { useReducedMotion } from 'motion/react';
import { useI18n } from '../../../../components/I18nProvider';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { Button } from '../../_components/Button';
import VeyCharacter from '../../_components/VeyCharacter';
import { FIRST_GOAL_EXAMPLES } from '../../_lib/firstGoal';
import { exampleSetFor } from '../../_lib/firstProfile';
import { readDeviceAnswers } from '../../_lib/firstProfileSync';
import { writeStudioDraft } from '../../_lib/landingDraft';
import { starterModel } from '../../_lib/starterModels';

// The grid has nothing to show. `fresh` is a Library with nothing in it at all,
// not a filter with no matches: only that one gets Vey and the examples Create's
// first-goal card offers. Each opens Create on the cheapest model of its kind
// with the prompt filled in, the way the landing price slip hands one over.
// `filtered` is the other case: there are creations, the chosen filters hide
// them all, and the one thing to offer is taking the filters off (`onClear`).
export function LibraryEmpty({ models, fresh, filtered = false, onClear }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const work = fresh && exampleSetFor(readDeviceAnswers().role) === 'work';
  const examples = fresh ? FIRST_GOAL_EXAMPLES.map((goal) => ({
    goal,
    prompt: t(work ? `app.create.firstRun.example.work.${goal}` : `app.create.firstGoal.example.${goal}`),
    model: starterModel(models, goal),
  })).filter((example) => example.model) : [];

  function handOver(prompt, model) {
    try {
      writeStudioDraft(window.sessionStorage, { prompt, model: model.id });
    } catch {
      // Private mode or storage off: Create still opens on the model.
    }
  }

  if (!fresh && filtered) {
    return (
      <div className="rounded-2xl border border-dashed border-vx-border p-8 text-center sm:p-12">
        <div data-testid="library-empty" className="text-lg font-black">{t("app.library.noMatch")}</div>
        <Button type="button" variant="ghost" size="sm" className="mt-5" data-testid="library-clear-filters" onClick={onClear}>
          {t("app.library.clearFilters")}</Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-dashed border-vx-border p-8 text-center sm:p-12">
      {fresh && <div aria-hidden="true" className="mx-auto mb-4 w-24"><VeyCharacter reducedMotion={reduced !== false} /></div>}
      <div data-testid="library-empty" className="text-lg font-black">{t("app.library.empty")}</div>
      <div className="text-[15px] text-vx-fg-body mt-1">{t("app.library.emptyHelp")}</div>
      {examples.length > 0 && (
        <ul className="mx-auto mt-5 grid max-w-3xl gap-2 text-start sm:grid-cols-3">
          {examples.map(({ goal, prompt, model }) => (
            <li key={goal}>
              <Link
                href={`/app/create?model=${encodeURIComponent(model.id)}`}
                onClick={() => handOver(prompt, model)}
                data-testid={`library-example-${goal}`}
                className="vx-press block h-full min-h-11 rounded-xl border border-vx-border px-3 py-2 hover:border-vx-fg-muted"
              >
                <span className="block text-sm font-bold text-vx-fg">{tOr(t, `app.create.firstGoal.${goal}`, goal)}</span>
                <span className="mt-0.5 block text-xs text-vx-fg-muted">{prompt}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {/* The examples are the action; beside them the studio is a quiet link, not a second button. */}
      {examples.length > 0 ? (
        <Link href="/app/create" className="mt-4 inline-flex min-h-11 items-center text-sm font-bold text-vx-accent underline-offset-4 hover:underline">
          {t("app.library.openStudio")}</Link>
      ) : (
        <Link href="/app/create" className="vx-press inline-block mt-5 rounded-full bg-vx-accent text-vx-accent-ink px-5 py-2.5 text-sm font-extrabold hover:bg-vx-accent-hover">
          {t("app.library.openStudio")}</Link>
      )}
    </div>
  );
}
