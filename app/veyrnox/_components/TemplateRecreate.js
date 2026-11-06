'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { writeStudioDraft } from '../_lib/landingDraft';
import {
  TEMPLATE_RECREATE_MODEL_ID,
  TEMPLATE_RECREATE_PROMPT_MAX,
  recreatePromptForTemplate,
  templateRecreateAvailable,
  templateRecreateHref,
} from '../_lib/templateRecreate';
import { useCatalog } from '../_lib/useCatalog';

export function TemplateRecreate({ preset }) {
  const { t } = useI18n();
  const router = useRouter();
  const { models, loading } = useCatalog();
  const [prompt, setPrompt] = useState(() => recreatePromptForTemplate(preset));
  const [status, setStatus] = useState('');
  const [opening, setOpening] = useState(false);
  const model = models.find((entry) => entry.id === TEMPLATE_RECREATE_MODEL_ID) || null;
  const available = templateRecreateAvailable(model);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus(t('common.copied'));
    } catch {
      setStatus(t('public.TemplateRecipe.selectThePromptTextAndCopy'));
    }
  }

  function openStudio() {
    if (!available || !prompt.trim() || opening) return;
    const saved = writeStudioDraft(window.sessionStorage, {
      prompt,
      model: TEMPLATE_RECREATE_MODEL_ID,
      durationSeconds: 5,
    });
    if (!saved) {
      setStatus(t('presets.recreate.handoffError'));
      return;
    }
    setOpening(true);
    router.push(templateRecreateHref(preset.id));
  }

  return (
    <section data-testid="template-recreate" aria-labelledby="template-recreate-title" className="mt-8 rounded-2xl border border-vx-accent/35 bg-vx-accent/[0.06] p-5">
      <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">{t('presets.recreate.eyebrow')}</p>
      <h2 id="template-recreate-title" className="mt-2 text-xl font-black tracking-tight">{t('presets.recreate.title')}</h2>
      <p className="mt-2 text-[13px] leading-6 text-vx-fg-muted">{t('presets.recreate.intro')}</p>

      <ol className="mt-4 grid gap-2 text-[13px] text-vx-fg-body">
        <li className="rounded-xl border border-vx-border bg-vx-panel/70 px-3 py-2"><span className="font-bold">{t('label.Source video')}</span> · {t('presets.recreate.videoRole')}</li>
        <li className="rounded-xl border border-vx-border bg-vx-panel/70 px-3 py-2"><span className="font-bold">{t('presets.recreate.image1Label')}</span> · {t('presets.recreate.image1Role')}</li>
        <li className="rounded-xl border border-vx-border bg-vx-panel/70 px-3 py-2"><span className="font-bold">{t('presets.recreate.image2Label')}</span> · {t('presets.recreate.image2Role')}</li>
      </ol>

      <label htmlFor={`recreate-prompt-${preset.id}`} className="mt-5 block font-vx-mono text-[10px] font-bold tracking-[0.12em] text-vx-fg-muted">{t('presets.recreate.prompt')}</label>
      <textarea
        id={`recreate-prompt-${preset.id}`}
        value={prompt}
        onChange={(event) => { setPrompt(event.target.value); setStatus(''); }}
        maxLength={TEMPLATE_RECREATE_PROMPT_MAX}
        rows={9}
        className="mt-2 w-full rounded-xl border border-vx-border bg-vx-panel px-4 py-3 text-[14px] leading-[1.55] text-vx-fg-body focus:border-vx-accent focus:outline-hidden"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={copyPrompt} className="vx-press rounded-full border border-vx-border px-4 py-2 text-sm font-bold hover:border-vx-fg-muted">{t('common.copy')}</button>
        <button type="button" onClick={openStudio} disabled={!available || loading || !prompt.trim() || opening} className="vx-press rounded-full bg-vx-accent px-5 py-2.5 text-sm font-extrabold text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-50">
          {t('presets.recreate.open')}
        </button>
        <span role="status" className="text-sm text-vx-fg-muted">{status}</span>
      </div>
      <p className="mt-3 text-[12px] leading-5 text-vx-fg-muted">{available ? t('presets.recreate.ready') : t('presets.recreate.unavailable')}</p>
    </section>
  );
}
