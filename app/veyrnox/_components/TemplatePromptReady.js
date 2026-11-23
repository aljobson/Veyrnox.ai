'use client';
import { useI18n } from '../../../components/I18nProvider.jsx';

export function TemplatePromptReady({ onEdit, ready = true, assistantTarget }) {
  const { t } = useI18n();
  const target = assistantTarget ? { 'data-assistant-target': assistantTarget, 'data-client-ready': ready ? 'true' : 'false' } : {};
  return (
    <div {...target} data-testid="template-prompt-ready" className="flex min-h-24 scroll-mt-24 flex-wrap items-center justify-between gap-3 p-3.5">
      <div role="status" className="min-w-0 flex-1">
        <p className="text-sm font-extrabold text-vx-fg">{t('app.create.templatePrompt.ready')}</p>
        <p className="mt-1 text-xs text-vx-fg-muted">{t('app.create.templatePrompt.help')}</p>
      </div>
      <button type="button" data-testid="template-prompt-edit" disabled={!ready} onClick={onEdit}
        className="vx-press min-h-11 shrink-0 rounded-full border border-vx-accent/50 px-4 py-2 text-xs font-extrabold text-vx-accent hover:bg-vx-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent disabled:opacity-50">
        {t('app.create.templatePrompt.edit')}
      </button>
    </div>
  );
}
