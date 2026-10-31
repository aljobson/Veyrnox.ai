'use client';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { templateById } from '../_lib/templates';
import { presetTitle } from '../_lib/tokens';
import { Spinner } from './Spinner';

const SETTLE_MS = 250;
const MAX_COVER_MS = 6000;

/**
 * The template name while a ?preset= link is being applied, else null.
 * Read before paint so the empty studio never flashes; cleared once the
 * catalog is in, or after MAX_COVER_MS so a slow catalog cannot hold it.
 * @param {boolean} catalogLoading
 * @returns {string | null}
 */
export function useTemplateOpening(catalogLoading) {
  const [name, setName] = useState(null);
  useLayoutEffect(() => {
    const preset = templateById(new URLSearchParams(window.location.search).get('preset'));
    if (preset) setName(presetTitle(preset.name));
  }, []);
  useEffect(() => {
    if (!name) return undefined;
    const timer = setTimeout(() => setName(null), catalogLoading ? MAX_COVER_MS : SETTLE_MS);
    return () => clearTimeout(timer);
  }, [name, catalogLoading]);
  return name;
}

// Covers the studio while a template from /presets is being applied.
export function TemplateOpening({ name }) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-vx-base/85 backdrop-blur-sm">
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-5 px-6 text-center">
        <span className="grid size-16 place-items-center rounded-full border border-vx-border bg-vx-panel text-vx-accent">
          <Spinner size={36} stroke={3} />
        </span>
        <div>
          {name && <p className="vx-display text-[22px] leading-tight sm:text-[26px]">{name}</p>}
          <p className="mt-1.5 font-vx-mono text-[11px] tracking-[0.14em] text-vx-fg-muted">{t('app.create.openingTemplate')}</p>
        </div>
      </div>
    </div>
  );
}
