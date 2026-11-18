'use client';
import { createContext, useContext } from 'react';
import { useTemplateSwapAvailable } from '../_lib/useTemplateSwapAvailable.js';
import { useCatalog } from '../_lib/useCatalog.js';
import { useI18n } from '../../../components/I18nProvider.jsx';
const SwapContext = createContext(null);
export function TemplateSwapBoundary({ id, children }) {
  const availability = useTemplateSwapAvailable(id);
  const { models, live } = useCatalog();
  const model = live ? models.find(m => m.id === availability.offer?.model) : null;
  return <SwapContext.Provider value={{ ...availability, offer: availability.offer ? { ...availability.offer, name: model?.name } : null }}>{children}</SwapContext.Provider>;
}
export function useResolvedSwap() { return useContext(SwapContext); }
export function TemplateSwapSummary({ children }) {
  const resolved = useResolvedSwap();
  const { t } = useI18n();
  if (!resolved?.offer) return children;
  return <div className="mt-4 space-y-4 text-vx-fg-body" data-template-swap-summary>
    <p>{t('presets.swap.model', { model: resolved.offer.name || t('presets.swap.loading') })}</p>
    <p>{t('presets.swap.onePhoto')}</p>
  </div>;
}
// Also used by the optional recreate CTA, which must never bypass an available swap.
export function TemplateSwapLegacy({ children }) { return useResolvedSwap()?.offer ? null : children; }
