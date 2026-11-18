'use client';
import { ChipSelect } from './ChipSelect';
import { resolutionVariants } from '../_lib/modelVariants';
import { clipCredits } from '../_lib/tokens';

// "720p · 24 cr / 1080p · 32 cr": picks between two catalog models that differ in resolution. Shows nothing for a
// model that has no counterpart. Prices come from the catalog rows; the label is only the resolution.
export function ResolutionVariantChoice({ model, models, seconds, onChoose, ariaLabel }) {
  const variants = resolutionVariants(model?.id, models);
  if (!variants.length) return null;
  const current = variants.find((variant) => variant.model.id === model.id);
  const priced = (variant) => `${variant.label} · ${clipCredits(variant.model.credits, seconds)}`;
  return (
    <ChipSelect assistantTarget="create.resolution" aria-label={ariaLabel} options={variants.map((variant) => variant.label)}
      value={current?.label} onChange={(label) => onChoose(variants.find((variant) => variant.label === label).model.id)}
      formatValue={(label) => label}
      formatOption={(label) => priced(variants.find((variant) => variant.label === label))} />
  );
}
