'use client';
import { useRouter } from 'next/navigation';
import { useI18n } from '../../../components/I18nProvider';
import { useCatalog } from '../_lib/useCatalog';
import { writeStudioDraft } from '../_lib/landingDraft.js';

// Hands an audio template to Create: the prompt travels in sessionStorage (the same
// draft the landing price slip writes), the model in the link. The price is the live
// catalog row's credits, shown only after a successful live read, never a constant from here.
export function UseAudioTemplate({ template }) {
  const router = useRouter();
  const { t } = useI18n();
  const { models, live } = useCatalog();
  const row = models.find((m) => m.id === template.modelId) || null;
  const tooLong = row ? template.prompt.length > row.promptMax : false;

  // No catalog row for this model (even in the bundled fallback) means Create would open on a
  // different model with this prompt, so the handoff stays off.
  const unavailable = !row;

  function onUse() {
    if (tooLong || unavailable) return;
    try {
      writeStudioDraft(window.sessionStorage, {
        prompt: template.prompt,
        model: template.modelId,
        ...(template.negativePrompt ? { negativePrompt: template.negativePrompt } : {}),
      });
    } catch {
      // Storage off: Create opens on the model without the prompt.
    }
    router.push(`/app/create?model=${encodeURIComponent(template.modelId)}`);
  }

  return (
    <div className="mt-6">
      <button type="button" onClick={onUse} disabled={tooLong || unavailable} className="vx-press inline-flex min-h-11 items-center rounded-full border border-vx-accent bg-vx-accent px-6 py-3 font-extrabold text-vx-accent-ink disabled:opacity-50">
        {live && row && typeof row.credits === 'number' ? t('audioTemplates.useWithPrice', { credits: row.credits }) : t('audioTemplates.use')}
      </button>
      {unavailable && <p role="alert" className="mt-2 text-[13px] font-bold text-vx-danger">{t('audioTemplates.unavailable')}</p>}
      {tooLong && <p role="alert" className="mt-2 text-[13px] font-bold text-vx-danger">{t('audioTemplates.tooLong', { model: row.name })}</p>}
      <p className="mt-3 text-[13px] text-vx-fg-muted">{t('audioTemplates.noCost')}</p>
    </div>
  );
}
