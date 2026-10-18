'use client';
import { physicalVeyPanelSide } from '../../../lib/veyPlacement';
import { useI18n } from '../../../components/I18nProvider';

export default function VeyPanelSideButton({ side, onMove }) {
  const { t, locale } = useI18n();
  const label = t(physicalVeyPanelSide(side, locale) === 'left' ? 'public.vey.panelsRight' : 'public.vey.panelsLeft');
  return <button type="button" onClick={onMove} aria-label={label} title={label}
    className="min-h-8 min-w-8 shrink-0 rounded-full text-xs text-vx-fg-muted hover:text-vx-fg focus-visible:outline-2 focus-visible:outline-vx-accent">
    <span aria-hidden="true">↔</span>
  </button>;
}
