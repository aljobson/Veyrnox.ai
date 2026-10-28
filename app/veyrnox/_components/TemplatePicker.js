'use client';

import { useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { PRESETS, searchTemplates } from '../_lib/templates.js';
import { presetTitle } from '../_lib/tokens.js';
import { runnableTemplates } from '../_lib/runnableTemplates.js';
import { templateHandoffVisual } from '../_lib/templateHandoff.js';
import { TemplateArtwork } from './TemplateArtwork';
import { Modal } from './Modal';

/** Choose a template from inside Create. Picking one hands it to onPick; nothing is charged here. */
export function TemplatePicker({ models, goal, onPick, onClose }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const search = useRef(null);
  const rows = useMemo(() => runnableTemplates(PRESETS, models, goal), [models, goal]);
  const shown = useMemo(() => {
    const matches = new Set(searchTemplates(rows.map((row) => row.preset), query));
    return rows.filter((row) => matches.has(row.preset));
  }, [rows, query]);

  // The shared Modal keeps focus inside, makes the page behind inert, closes on
  // Escape or a click on the backdrop, and puts focus back on the opener.
  return (
    <Modal onCancel={onClose} initialFocusRef={search} aria-labelledby="create-template-picker-title" data-testid="create-template-picker" className="items-center justify-center p-4">
      <div className="w-full max-w-[860px] max-h-[85dvh] overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="create-template-picker-title" className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-fg-muted">{t('app.create.templates.title')}</h2>
          <button type="button" onClick={onClose} aria-label={t('authGate.close')} className="text-vx-fg-muted hover:text-vx-fg">✕</button>
        </div>
        <p className="mt-2 text-xs text-vx-fg-muted">{t('app.create.templates.help')}</p>
        <input ref={search} type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          aria-label={t('app.create.templates.search')} placeholder={t('app.create.templates.search')}
          className="mt-4 w-full rounded-lg border border-vx-field bg-vx-base px-3 py-2 text-sm text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-hidden" />
        {shown.length === 0 && <p className="mt-4 text-sm text-vx-fg-muted">{t('app.create.templates.empty')}</p>}
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {shown.map(({ preset, model }) => {
            const title = presetTitle(preset.name);
            const visual = templateHandoffVisual(preset);
            return (
              <li key={preset.id}>
                <button type="button" onClick={() => onPick(preset)} aria-label={t('app.create.templates.use', { title })}
                  data-testid={`create-template-${preset.id}`}
                  className="group block w-full overflow-hidden rounded-lg border border-vx-border text-start hover:border-vx-accent focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent">
                  <div className="relative aspect-[3/4] bg-vx-base">
                    {visual?.kind === 'video'
                      ? <img src={visual.poster} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                      : <TemplateArtwork preset={preset} eyebrow={model.name} title={title} compact />}
                  </div>
                  <div className="p-2">
                    <div className="truncate text-xs font-extrabold text-vx-fg">{title}</div>
                    <div className="truncate font-vx-mono text-[10px] text-vx-fg-muted">{tOr(t, `presets.cat.${preset.category}`, preset.category)} · {model.name}</div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
