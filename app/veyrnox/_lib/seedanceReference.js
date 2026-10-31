// ADR-0309: templates made for Seedance take reference pictures, not a start and end frame.
// The reference model ships staged (inactive) until a billed run proves its price, so the template
// mapping is off. Activation is one change: the activating migration plus this constant set to true.
export const SEEDANCE_REFERENCE_ACTIVE = false;
export const SEEDANCE_REFERENCE_MODEL = 'Seedance 2.0 · Reference';
export const SEEDANCE_REFERENCE_CREDITS = 85;
const FRAME_MODEL = 'Kling 3.0 · I2V';

/** True for a template whose source was made with Seedance but which today runs on the frame model. */
export const takesReferenceModel = (source, active = SEEDANCE_REFERENCE_ACTIVE) =>
  active === true && /^Seedance\b/.test(source?.sourceModel || '') && source?.runnableModel === FRAME_MODEL;
