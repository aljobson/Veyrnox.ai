export const VERIFIED = 'verified';
export const MAX_ATTEMPTS = 5;

export function needsStepUp(aal, factors) {
  return aal === 'aal1' && Array.isArray(factors) && factors.some(f => f.status === VERIFIED);
}

export function pickFactorId(factors) {
  return Array.isArray(factors) ? factors.find(f => f.status === VERIFIED)?.id ?? null : null;
}

export function isLockedOut(attempts) {
  return attempts >= MAX_ATTEMPTS;
}
