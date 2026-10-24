export function shouldShowVeyCharacter({ open = false, activeTarget = null, actionPhase = 'none' } = {}) {
  return Boolean(open || activeTarget || actionPhase !== 'none');
}
