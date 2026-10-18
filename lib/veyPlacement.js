export const VEY_PLACEMENT_STORAGE = 'veyrnox.vey.placement.v1';
export const DEFAULT_VEY_PLACEMENT = Object.freeze({ side: 'left', position: null });

function normalisePlacement(value) {
  const point = value?.position;
  return {
    side: value?.side === 'right' ? 'right' : 'left',
    position: point && typeof point.x === 'number' && Number.isFinite(point.x)
      && typeof point.y === 'number' && Number.isFinite(point.y)
      ? { x: point.x, y: point.y } : null,
  };
}

export function readVeyPlacement(storage) {
  try {
    const value = JSON.parse(storage.getItem(VEY_PLACEMENT_STORAGE));
    return value?.version === 1 ? normalisePlacement(value) : DEFAULT_VEY_PLACEMENT;
  } catch { return DEFAULT_VEY_PLACEMENT; }
}

export function writeVeyPlacement(storage, placement) {
  try {
    // Never persist task, source, transcript or consent state with UI preferences.
    storage.setItem(VEY_PLACEMENT_STORAGE, JSON.stringify({ version: 1, ...normalisePlacement(placement) }));
    return true;
  } catch { return false; }
}

// Stored sides describe the LTR placement; mirror only dock geometry in RTL.
export function physicalVeyPanelSide(side, locale) {
  return locale === 'ar' ? (side === 'right' ? 'left' : 'right') : side;
}
