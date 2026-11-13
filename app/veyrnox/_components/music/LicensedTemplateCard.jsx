'use client';

import { useI18n } from '../../../../components/I18nProvider';
import { tOr } from '../../../../lib/i18n/translate.mjs';

const categoryKey = (category) => `musicDiscover.cat.${category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

/** Read-only card for an attached licensed-track template. Only the style direction is used, never the audio. */
export function LicensedTemplateCard({ template, onRemove, disabled = false }) {
  const { t } = useI18n();
  if (!template) return null;
  return (
    <section aria-label={t('musicDiscover.lic.template.eyebrow')} data-testid="licensed-template-card" className="overflow-hidden rounded-2xl border border-vx-border-boost bg-vx-base">
      <div className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="font-vx-mono text-[10px] font-bold uppercase tracking-widest text-vx-accent">{t('musicDiscover.lic.template.eyebrow')} · {tOr(t, categoryKey(template.category), template.category)}</p>
          <h3 className="mt-1 truncate font-vx text-lg font-black">{template.title}</h3>
          <p className="truncate text-xs text-vx-fg-muted">{template.creator} · {template.license}</p>
        </div>
        <button type="button" onClick={onRemove} disabled={disabled} aria-label={t('musicDiscover.lic.template.removeLabel', { title: template.title })} className="min-h-11 shrink-0 rounded-full border border-vx-border px-4 text-xs font-bold text-vx-fg-body hover:text-vx-fg disabled:opacity-40">
          {t('musicDiscover.lic.template.remove')}
        </button>
      </div>
      <p className="border-t border-vx-border px-3 py-2 text-[11px] leading-4 text-vx-fg-faint"><strong>{t('musicDiscover.lic.credit')}</strong> {template.attribution}</p>
      <p className="border-t border-vx-border px-3 py-2 text-[11px] leading-4 text-vx-fg-faint">{t('musicDiscover.lic.template.note')}</p>
    </section>
  );
}
