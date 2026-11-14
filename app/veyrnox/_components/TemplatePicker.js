'use client';

import Link from 'next/link';
import { useMemo, useRef } from 'react';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { pluralKey } from '../../../lib/i18n/translate.mjs';
import { createTemplatesFor } from '../_lib/createTemplates.js';
import { modelNameForId, presetCredits, presetTitle, templateModelId } from '../_lib/tokens.js';
import { Modal } from './Modal';

const CREATE_KINDS = new Set(['video', 'image', 'audio']);

/** Three curated, runnable starts for the medium selected in Create. */
export function TemplatePicker({ models, goal, selectedKind, onPick, onClose }) {
  const { t, locale } = useI18n();
  const firstChoice = useRef(null);
  const closeButton = useRef(null);
  const kind = CREATE_KINDS.has(goal) ? goal : CREATE_KINDS.has(selectedKind) ? selectedKind : 'video';
  const rows = useMemo(() => createTemplatesFor(kind).map((preset) => {
    const modelId = templateModelId(preset);
    const model = models.find((item) => item.id === modelId) || null;
    return { preset, model, modelName: model?.name || modelNameForId(modelId), credits: presetCredits(preset, models) };
  }), [kind, models]);
  const firstEnabledIndex = rows.findIndex(({ model }) => model);
  const initialFocusRef = firstEnabledIndex === -1 ? closeButton : firstChoice;

  return (
    <Modal onCancel={onClose} initialFocusRef={initialFocusRef} aria-labelledby="create-template-picker-title" data-testid="create-template-picker" className="items-center justify-center p-4">
      <div className="w-full max-w-[920px] max-h-[85dvh] overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-accent">{t('app.create.templates.title')} · {t(`app.create.goal.${kind}`)}</div>
            <h2 id="create-template-picker-title" className="mt-1 text-xl font-extrabold text-vx-fg">{t('app.create.templates.title')} · {rows.length}</h2>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label={t('authGate.close')} className="min-h-11 min-w-11 text-vx-fg-muted hover:text-vx-fg">✕</button>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-vx-fg-muted">{t('app.create.templates.help')}</p>

        <ul className="mt-5 grid gap-4 sm:grid-cols-3">
          {rows.map(({ preset, model, modelName, credits }, index) => {
            const title = presetTitle(preset.name);
            return (
              <li key={preset.id} className="overflow-hidden rounded-2xl border border-vx-border bg-vx-base">
                <div className="relative aspect-[4/3] overflow-hidden" style={{ background: preset.bg }}>
                  <img src={preset.previewImage} alt={title} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                </div>
                {kind === 'audio' && (
                  <div className="border-b border-vx-border px-3 py-3">
                    <audio controls preload="metadata" src={preset.previewAudio} aria-label={preset.previewTitle} className="h-10 w-full" />
                    <p className="mt-2 text-[11px] leading-4 text-vx-fg-muted">
                      {t('musicDiscover.lic.template.note')}
                    </p>
                    <p className="mt-1 text-[11px] leading-4 text-vx-fg-muted">
                      {preset.previewAttribution}{' · '}
                      <a href={preset.previewSourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{t('musicDiscover.lic.source')}</a>{' · '}
                      <a href={preset.previewLicenseUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{preset.previewLicense}</a>
                    </p>
                  </div>
                )}
                <div className="p-3">
                  <h3 className="text-sm font-extrabold text-vx-fg">{title}</h3>
                  <p className="mt-1 font-vx-mono text-[10px] text-vx-fg-muted">
                    {modelName || t('app.create.templates.unavailable')}
                    {Number.isFinite(credits) ? ` · ${t(pluralKey(t, locale, 'model.credits', credits), { n: credits })}` : ''}
                  </p>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-vx-fg-body">{preset.prompt}</p>
                  <button ref={index === firstEnabledIndex ? firstChoice : undefined} type="button" onClick={() => onPick(preset)} disabled={!model}
                    aria-label={model ? t('app.create.templates.use', { title }) : `${t('app.create.templates.use', { title })} · ${t('app.create.templates.unavailable')}`} data-testid={`create-template-${preset.id}`}
                    className="vx-press mt-3 min-h-11 w-full rounded-full bg-vx-accent px-4 text-sm font-extrabold text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-45">
                    {model ? t('app.create.templates.use', { title }) : t('app.create.templates.unavailable')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        {kind === 'audio' && <div className="mt-4 text-right text-xs"><Link href="/app/music/discover" className="font-bold text-vx-accent underline underline-offset-2">{t('musicDiscover.title')}</Link></div>}
      </div>
    </Modal>
  );
}
