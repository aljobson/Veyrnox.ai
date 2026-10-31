// ADR-0309: templates made for Seedance take reference pictures, not a start and end frame.
// Turned on by the owner 2026-10-31 (migration 0417). Set false, with the row inactive, to put the templates back on Kling.
export const SEEDANCE_REFERENCE_ACTIVE = true;
export const SEEDANCE_REFERENCE_MODEL = 'Seedance 2.0 · Reference';
export const SEEDANCE_REFERENCE_CREDITS = 85;
const FRAME_MODEL = 'Kling 3.0 · I2V';

/** True for a template whose source was made with Seedance but which today runs on the frame model. */
export const takesReferenceModel = (source, active = SEEDANCE_REFERENCE_ACTIVE) =>
  active === true && /^Seedance\b/.test(source?.sourceModel || '') && source?.runnableModel === FRAME_MODEL;
