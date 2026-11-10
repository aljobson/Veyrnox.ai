'use client';

import { useMemo, useState } from 'react';
import {
  DUBBING_BATCH_EXAMPLE,
  MAX_DUBBING_LOCALES,
  MAX_DUBBING_PROJECT_NAME,
  MAX_DUBBING_TRANSLATION,
  MIN_DUBBING_LOCALES,
  dubbingBatchQuote,
  dubbingLocaleHandoff,
  normalizeDubbingBatch,
} from '../_lib/dubbingBatch';
import { TTS_LANGUAGES } from '../_lib/textToSpeech';

const languages = TTS_LANGUAGES.filter((language) => language !== 'auto');
const input = 'w-full rounded-xl border border-vx-border bg-vx-base px-3 py-2.5 text-sm text-vx-fg focus:border-vx-accent focus:outline-hidden disabled:opacity-50';

const blankPlan = () => ({
  projectName: '',
  locales: [
    { targetLanguage: 'Spanish', script: '' },
    { targetLanguage: 'French', script: '' },
  ],
});

export function DubbingLocalePlanner({
  unitCredits,
  balance,
  onUseLocale,
  onGenerateBatch,
  generationBlockedReason = '',
  disabled = false,
  mode = 'dubbing',
}) {
  const [plan, setPlan] = useState(blankPlan);
  const normalized = useMemo(() => normalizeDubbingBatch(plan), [plan]);
  const quote = useMemo(() => dubbingBatchQuote(plan, unitCredits), [plan, unitCredits]);

  function updateLocale(index, patch) {
    setPlan((current) => ({
      ...current,
      locales: current.locales.map((locale, localeIndex) => localeIndex === index ? { ...locale, ...patch } : locale),
    }));
  }

  function addLocale() {
    setPlan((current) => {
      if (current.locales.length >= MAX_DUBBING_LOCALES) return current;
      const used = new Set(current.locales.map((locale) => locale.targetLanguage));
      const nextLanguage = languages.find((language) => !used.has(language));
      return nextLanguage ? { ...current, locales: [...current.locales, { targetLanguage: nextLanguage, script: '' }] } : current;
    });
  }

  function removeLocale(index) {
    setPlan((current) => current.locales.length <= MIN_DUBBING_LOCALES
      ? current
      : { ...current, locales: current.locales.filter((_, localeIndex) => localeIndex !== index) });
  }

  function applyLocale(index) {
    const handoff = dubbingLocaleHandoff(plan, index);
    if (handoff) onUseLocale?.(handoff);
  }

  const insufficientCredits = quote && Number.isFinite(balance) && quote.totalCredits > balance;
  const generateDisabled = disabled || !normalized || !onGenerateBatch || Boolean(generationBlockedReason) || insufficientCredits;
  const productPresenter = mode === 'product-presenter';
  const outputNoun = productPresenter ? 'presenter videos' : 'dubbed videos';
  const stageDescription = productPresenter ? 'speech and presenter-animation' : 'speech and lip-sync';

  return (
    <details className="rounded-2xl border border-vx-border bg-vx-panel">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent sm:p-5">
        <span>
          <span className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">MULTI-LOCALE PLAN</span>
          <span className="mt-1 block text-lg font-black">{productPresenter ? 'Create multilingual presenter versions.' : 'Review several translations before rendering.'}</span>
          <span className="mt-1 block text-xs leading-5 text-vx-fg-muted">Prepare 2–5 locales, compare one exact total, then approve the whole batch once.</span>
        </span>
        <span aria-hidden="true" className="text-xl text-vx-accent">＋</span>
      </summary>
      <div className="border-t border-vx-border p-4 sm:p-5">
        <div className="rounded-xl border border-vx-accent/30 bg-vx-accent/[0.06] px-4 py-3 text-xs leading-5 text-vx-fg-muted">
          <strong className="text-vx-fg">Reviewed text only.</strong> Veyrnox does not auto-translate here. Editing and loading examples cost nothing; only the explicit batch button below can submit work.
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 text-xs font-extrabold">Project name
            <input value={plan.projectName} maxLength={MAX_DUBBING_PROJECT_NAME} disabled={disabled} onChange={(event) => setPlan((current) => ({ ...current, projectName: event.target.value }))} placeholder="e.g. October product update" className={`${input} mt-2`} />
          </label>
          <button type="button" disabled={disabled} onClick={() => setPlan({ projectName: DUBBING_BATCH_EXAMPLE.projectName, locales: DUBBING_BATCH_EXAMPLE.locales.map((locale) => ({ ...locale })) })} className="min-h-10 rounded-full border border-vx-border px-4 text-xs font-extrabold hover:border-vx-accent disabled:opacity-50">Load fictional example</button>
        </div>
        <ol className="mt-4 space-y-3" aria-label={productPresenter ? 'Reviewed product presenter locales' : 'Reviewed dubbing locales'}>
          {plan.locales.map((locale, index) => {
            const duplicate = plan.locales.some((candidate, candidateIndex) => candidateIndex !== index && candidate.targetLanguage === locale.targetLanguage);
            const handoff = normalized ? dubbingLocaleHandoff(normalized, index) : null;
            return (
              <li key={`${index}-${locale.targetLanguage}`} className="rounded-xl border border-vx-border bg-vx-base p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-vx-accent/40 font-vx-mono text-[10px] font-bold text-vx-accent">{String(index + 1).padStart(2, '0')}</span>
                  <label className="min-w-[180px] flex-1 text-xs font-extrabold">Target language
                    <select value={locale.targetLanguage} disabled={disabled} onChange={(event) => updateLocale(index, { targetLanguage: event.target.value })} className={`${input} mt-2`}>
                      {languages.map((language) => <option key={language} value={language}>{language}</option>)}
                    </select>
                    {duplicate && <span role="alert" className="mt-1 block text-[10px] text-vx-danger">Choose each target language once.</span>}
                  </label>
                  <button type="button" disabled={disabled || plan.locales.length <= MIN_DUBBING_LOCALES} onClick={() => removeLocale(index)} className="min-h-10 rounded-full px-3 text-xs font-bold text-vx-fg-muted hover:text-vx-danger disabled:opacity-30">Remove</button>
                </div>
                <label className="mt-3 block text-xs font-extrabold">Reviewed translation
                  <textarea value={locale.script} maxLength={MAX_DUBBING_TRANSLATION} disabled={disabled} onChange={(event) => updateLocale(index, { script: event.target.value })} rows={3} placeholder="Paste text reviewed by a fluent speaker…" className={`${input} mt-2 resize-y`} />
                </label>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-faint">{locale.script.length}/{MAX_DUBBING_TRANSLATION}</span>
                  <button type="button" disabled={disabled || !handoff} onClick={() => applyLocale(index)} className="min-h-10 rounded-full bg-vx-accent px-4 text-xs font-extrabold text-vx-accent-ink disabled:opacity-40">Use {locale.targetLanguage} in editor</button>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-vx-border pt-4">
          <button type="button" disabled={disabled || plan.locales.length >= MAX_DUBBING_LOCALES} onClick={addLocale} className="min-h-10 rounded-full border border-vx-border px-4 text-xs font-extrabold hover:border-vx-accent disabled:opacity-40">Add locale</button>
          <div aria-live="polite" className="text-right">
            <p className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-faint">EXACT BATCH TOTAL</p>
            <p className="mt-1 text-lg font-black text-vx-money">{quote ? `${quote.totalCredits} credits` : 'Complete every translation'}</p>
            {quote && <p className="text-[10px] text-vx-fg-muted">{quote.locales} locale chains × {quote.unitCredits} credits</p>}
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-vx-border bg-vx-base p-4">
          <button
            type="button"
            disabled={generateDisabled}
            onClick={() => onGenerateBatch?.(normalized)}
            className="min-h-12 w-full rounded-full bg-vx-accent px-5 text-sm font-black text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {quote ? `Generate ${quote.locales} ${outputNoun} · ${quote.totalCredits} credits` : 'Complete the batch plan'}
          </button>
          <p aria-live="polite" className={`mt-2 text-center text-[11px] leading-4 ${insufficientCredits ? 'text-vx-danger' : 'text-vx-fg-muted'}`}>
            {insufficientCredits
              ? `This batch needs ${quote.totalCredits} credits; your current balance is ${balance}.`
              : generationBlockedReason || `One click authorizes every listed ${stageDescription} job. Each failed job keeps its own automatic refund path.`}
          </p>
        </div>
      </div>
    </details>
  );
}
