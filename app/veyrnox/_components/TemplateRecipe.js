'use client';
import { useI18n } from '../../../components/I18nProvider.jsx';

import { presetStep } from '../../../lib/i18n/presetSteps.mjs';
import { useState } from 'react';
import { UseTemplate } from './UseTemplate';
import { TEMPLATE_PROMPT_MAX } from '../_lib/templateDraft';

function CopyPrompt({ text, label }) {
  const { t } = useI18n();
  const [status, setStatus] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(t("common.copied"));
    } catch {
      setStatus(t("public.TemplateRecipe.selectThePromptTextAndCopy"));
    }
  }
  return (
    <div className="mt-3">
      <button type="button" onClick={copy} className="vx-press rounded-full border border-vx-border px-4 py-2 text-sm font-bold hover:border-vx-fg-muted">{label}</button>
      <span role="status" className="ms-3 text-sm text-vx-fg-muted">{status}</span>
    </div>
  );
}

export function TemplateRecipe({ preset, generatedPreview = false }) {
  const { t } = useI18n();
  const hasExactSourcePrompt = preset.sourcePromptOrigin === 'community-source-exact' && typeof preset.sourcePrompt === 'string';
  // With an exact community prompt it is the only prompt: shown, copied and sent to generation as received.
  const startPrompt = hasExactSourcePrompt ? preset.sourcePrompt : preset.prompt;
  const [prompt, setPrompt] = useState(startPrompt);
  const handoffPreset = hasExactSourcePrompt ? { ...preset, prompt: preset.sourcePrompt } : preset;
  const tooLong = prompt.length > TEMPLATE_PROMPT_MAX;
  const promptLabel = hasExactSourcePrompt ? t("public.TemplateRecipe.exactCommunityPrompt") : preset.promptOrigin === 'veyrnox-adaptation' ? t("public.TemplateRecipe.generationPrompt") : t("public.TemplateRecipe.prompt");
  return (
    <>
      <h2 className="mt-8 font-vx-mono text-[11px] tracking-[0.12em] text-vx-fg-muted">{promptLabel}</h2>
      <textarea aria-label={promptLabel} value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={hasExactSourcePrompt ? undefined : TEMPLATE_PROMPT_MAX} rows={hasExactSourcePrompt ? 12 : 8} dir={hasExactSourcePrompt ? "auto" : undefined}
        className="mt-2 w-full rounded-xl border border-vx-border bg-vx-panel px-4 py-3 text-[15px] leading-[1.55] text-vx-fg-body focus:outline-hidden focus:border-vx-accent" />
      <CopyPrompt text={prompt} label={hasExactSourcePrompt ? t("public.TemplateRecipe.copyExactCommunityPrompt") : t("public.TemplateRecipe.copyPrompt")} />
      {tooLong && <p role="alert" className="mt-3 text-[13px] font-bold text-vx-danger">{t("public.TemplateRecipe.promptTooLong", { count: prompt.length, max: TEMPLATE_PROMPT_MAX })}</p>}
      <p className="mt-3 text-[13px] text-vx-fg-muted">{hasExactSourcePrompt ? t("public.TemplateRecipe.exactCommunityPromptHelp") : generatedPreview ? t("public.TemplateRecipe.thePreviewWasGeneratedUsingThis") : preset.inspired ? t("public.TemplateRecipe.adaptedForTheModelBelowTo") : t("public.TemplateRecipe.editItHereOrInThe")}</p>
      {preset.steps && (
        <ol className="mt-5 list-decimal space-y-2 ps-5 text-sm text-vx-fg-body">
          {preset.steps.map((step) => <li key={step}>{presetStep(t, step)}</li>)}
        </ol>
      )}
      <UseTemplate preset={handoffPreset} prompt={prompt} />
    </>
  );
}
