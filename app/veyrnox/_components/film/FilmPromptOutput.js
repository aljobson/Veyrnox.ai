'use client';
import { localeTag } from '../../../../lib/i18n/locales.mjs';

import { useI18n } from '../../../../components/I18nProvider';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { writeStudioDraft } from '../../_lib/landingDraft';
import { filmAspectCompatible } from '../../_lib/authenticatedMedia';

export function FilmPromptOutput({ title, prompt, modelId, access, models, live, aspect, duration }) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale), {useGrouping:false, maximumFractionDigits:20}).format(value);
  const router=useRouter(); const [notice,setNotice]=useState('');
  const model=models.find(m=>m.id===modelId&&m.takesPrompt!==false&&!m.gated&&!m.isEdit&&!m.takesTopic&&!m.takesPlan);
  const max=model?.promptMax||2000;
  const aspectCompatible=filmAspectCompatible(model,aspect);
  const canOpen=access==='Studio'&&live&&model&&prompt.length<=max&&(!duration||model.durations?.includes(duration))&&aspectCompatible;
  const open=()=>{
    if(!canOpen)return;
    if(!writeStudioDraft(window.sessionStorage,{prompt,model:modelId,aspect,durationSeconds:duration})){setNotice(t("app.film.output.saveFailed"));return;}
    router.push(`/app/create?model=${encodeURIComponent(modelId)}`);
  };
  const copy=async()=>{try{await navigator.clipboard.writeText(prompt);setNotice(t("app.film.output.copied"));}catch{setNotice(t("app.film.output.copyHelp"));}};
  return <section className="space-y-3 rounded-xl border border-vx-border p-4"><h3 className="text-sm font-bold">{title}</h3>
    <textarea aria-label={title} readOnly value={prompt} rows={8} className="w-full rounded-lg border border-vx-field bg-vx-panel p-3 font-vx-mono text-xs focus:border-vx-accent focus:outline-none"/>
    <div className="flex flex-wrap gap-3"><button type="button" onClick={copy} className="text-sm font-semibold text-vx-accent">{t("public.TemplateRecipe.copyPrompt")}</button>
      {canOpen&&<button data-testid="film-open-in-studio" type="button" onClick={open} className="rounded-full bg-vx-accent px-4 py-2 text-sm font-semibold text-vx-accent-ink">{t("app.film.output.open")}</button>}</div>
    {access==='Studio'&&!canOpen&&<p className="text-xs text-vx-fg-muted">{prompt.length>max?t("app.film.output.limit",{max:number(max)}):duration&&model&&!model.durations?.includes(duration)?t("app.film.output.duration"):!aspectCompatible?t("app.film.output.aspect"):t("app.film.output.catalog")}</p>}
    {canOpen&&<p className="text-xs text-vx-fg-muted">{t("app.film.output.price")}</p>}
    {notice&&<p role="status" className="text-xs">{notice}</p>}
  </section>;
}
