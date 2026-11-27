import { clipCredits } from './tokens.js';

export function templateCatalogCredits(item, modelPrices = {}) {
  const modelKey = item?.modelId || item?.model;
  const unit = modelPrices[modelKey] ?? (Number.isInteger(item?.credits) && item.credits > 0 ? item.credits : null);
  if (!Number.isInteger(unit) || unit < 1) return null;
  return item?.modelId && item?.durationSeconds ? clipCredits(unit, item.durationSeconds) : unit;
}
