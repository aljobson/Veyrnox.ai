// Attribution is unused. Remove legacy records without collecting new ones.
export const ATTRIBUTION_KEY = 'veyrnox_attribution';
export function clearAttribution() {
  try { localStorage.removeItem(ATTRIBUTION_KEY); } catch { /* storage blocked */ }
}
