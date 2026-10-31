'use client';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { presetTitle } from '../_lib/tokens';
import { Spinner } from './Spinner';

const SETTLE_MS = 250;
const MAX_COVER_MS = 6000;
const TEMPLATE_ID_RE = /^[a-z0-9-]{1,40}$/;

/**
 * { name } while a ?preset= link is being applied, else null. Shown before
 * paint so the empty studio never flashes. The catalog is not in the bundle,
 * so the name arrives with the template the studio fetches (`template`:
 * undefined until then, null when there is no such template) and the cover
 * clears SETTLE_MS after that and the catalog are in, or after MAX_COVER_MS
 * so a slow read cannot hold it.
 * @param {boolean} catalogLoading
 * @param {object | null | undefined} template
 * @returns {{ name: string | null } | null}
 */
export function useTemplateOpening(catalogLoading, template) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (TEMPLATE_ID_RE.test(new URLSearchParams(window.location.search).get('preset') || '')) setOpen(true);
  }, []);
  const settled = template !== undefined && !catalogLoading;
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => setOpen(false), settled ? SETTLE_MS : MAX_COVER_MS);
    return () => clearTimeout(timer);
  }, [open, settled]);
  return open ? { name: template?.name ? presetTitle(template.name) : null } : null;
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
