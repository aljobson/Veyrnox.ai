// Which model a one-photo template binds to (ADR-0309 amendment 3). Kling 3.0 image-to-video stays the people-safe default; a
// recipe whose exact bound text is over Kling's published 2,500 characters and at most kie Seedance 2's 20,000 binds to the
// long-prompt offer instead. Nothing is trimmed: a text over both limits keeps the Kling target and the audit marks it prompt-limit.
import { PEOPLE_BINDING_MODEL } from './templateBinding.js';
import { KLING_V3_PROMPT_MAX } from './generationPromptLimits.js';
import { SEEDANCE_LONG_MODEL_ID, SEEDANCE_LONG_PROMPT_MAX } from './seedanceLongTemplates.js';

export function longPromptTarget(defaultTarget, boundLength, slotCount) {
  if (defaultTarget !== PEOPLE_BINDING_MODEL || slotCount !== 1) return defaultTarget;
  return boundLength > KLING_V3_PROMPT_MAX && boundLength <= SEEDANCE_LONG_PROMPT_MAX ? SEEDANCE_LONG_MODEL_ID : defaultTarget;
}
