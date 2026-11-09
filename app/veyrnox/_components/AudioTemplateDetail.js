import Link from 'next/link';
import { UseAudioTemplate } from './UseAudioTemplate';
import { MODELS, presetTitle } from '../_lib/tokens';
import { localizedHref } from '../../../lib/i18n/locales.mjs';

// One audio template, shown on /presets/<id> when the id names one (see presets/[id]/page.js).
export function AudioTemplateDetail({ t, locale, template }) {
  const model = MODELS.find((m) => m.id === template.modelId);
  return (
    <div className="max-w-[720px]">
      <Link href={localizedHref(locale, '/presets?kind=audio')} className="text-[14px] text-vx-fg-muted hover:text-vx-fg underline-offset-4 hover:underline">{t('audioTemplates.back')}</Link>
      <p className="mt-6 font-vx-mono text-[11px] tracking-[0.12em] text-vx-fg-muted">{t(`audioTemplates.cat.${template.category}`)}</p>
      <h1 className="mt-2 vx-display vx-title-detail">{presetTitle(template.name)}</h1>
      <p className="mt-4 text-vx-fg-body">{t('audioTemplates.runsOn')} <Link href={localizedHref(locale, `/models/${encodeURIComponent(template.modelId)}`)} className="font-bold underline underline-offset-4">{model?.name || template.modelId}</Link>.</p>
      <h2 className="mt-8 text-[13px] font-bold text-vx-fg">{t('audioTemplates.promptHeading')}</h2>
      <p className="mt-2 rounded-xl border border-vx-border px-4 py-3 text-[15px] text-vx-fg-body whitespace-pre-wrap">{template.prompt}</p>
      {template.negativePrompt && <p className="mt-3 text-[13px] text-vx-fg-muted">{t('audioTemplates.avoids', { text: template.negativePrompt })}</p>}
      <UseAudioTemplate template={template} />
    </div>
  );
}
