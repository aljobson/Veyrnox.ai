'use client';
import { useI18n } from '../../../components/I18nProvider.jsx';

import { presetStep } from '../../../lib/i18n/presetSteps.mjs';
import { useState } from 'react';
import { UseTemplate } from './UseTemplate';

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
  const [prompt, setPrompt] = useState(preset.prompt);
  const hasExactSourcePrompt = preset.sourcePromptOrigin === 'community-source-exact' && typeof preset.sourcePrompt === 'string';
  const hasAdaptedGenerationPrompt = preset.promptOrigin === 'veyrnox-adaptation';
  const promptLabel = hasExactSourcePrompt || hasAdaptedGenerationPrompt ? t("public.TemplateRecipe.generationPrompt") : t("public.TemplateRecipe.prompt");
  return (
    <>
      {hasExactSourcePrompt && <>
        <h2 className="mt-8 font-vx-mono text-[11px] tracking-[0.12em] text-vx-fg-muted">{t("public.TemplateRecipe.exactCommunityPrompt")}</h2>
        <textarea aria-label={t("public.TemplateRecipe.exactCommunityPrompt")} value={preset.sourcePrompt} readOnly rows={10} dir="auto"
          className="mt-2 w-full rounded-xl border border-vx-border bg-vx-panel px-4 py-3 text-[15px] leading-[1.55] text-vx-fg-body focus:outline-hidden focus:border-vx-accent" />
        <CopyPrompt text={preset.sourcePrompt} label={t("public.TemplateRecipe.copyExactCommunityPrompt")} />
        <p className="mt-3 text-[13px] text-vx-fg-muted">{t("public.TemplateRecipe.exactCommunityPromptHelp")}</p>
      </>}
      <h2 className="mt-8 font-vx-mono text-[11px] tracking-[0.12em] text-vx-fg-muted">{promptLabel}</h2>
      <textarea aria-label={promptLabel} value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} rows={8}
        className="mt-2 w-full rounded-xl border border-vx-border bg-vx-panel px-4 py-3 text-[15px] leading-[1.55] text-vx-fg-body focus:outline-hidden focus:border-vx-accent" />
      <CopyPrompt text={prompt} label={t("public.TemplateRecipe.copyPrompt")} />
      <p className="mt-3 text-[13px] text-vx-fg-muted">{generatedPreview ? t("public.TemplateRecipe.thePreviewWasGeneratedUsingThis") : preset.inspired ? t("public.TemplateRecipe.adaptedForTheModelBelowTo") : t("public.TemplateRecipe.editItHereOrInThe")}</p>
      {preset.steps && (
        <ol className="mt-5 list-decimal space-y-2 ps-5 text-sm text-vx-fg-body">
          {preset.steps.map((step) => <li key={step}>{presetStep(t, step)}</li>)}
        </ol>
      )}
      <UseTemplate preset={preset} prompt={prompt} />
    </>
  );
}
