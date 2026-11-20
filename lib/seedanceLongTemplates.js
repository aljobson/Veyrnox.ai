// Long-prompt photo templates on kie Seedance 2 (ADR-0309 amendment 3, ADR-0333 amendment 3).
// A one-photo template whose exact bound prompt is over Kling 3.0's 2,500 characters and at most kie's 20,000 runs on this
// offer, with the photo as its one reference picture. Dark until the owner turns the runtime key on: while it is off the
// catalog does not list the offer, the gateway refuses it before any charge, and the templates stay out of the gallery.
import { appRuntimeFlag } from './appRuntime.js';

export const SEEDANCE_LONG_MODEL_ID = 'seedance-2.0-photo-kie';
export const SEEDANCE_LONG_ENDPOINT = 'market:bytedance/seedance-2';
// kie's published prompt limit for bytedance/seedance-2 (docs.kie.ai/market/bytedance/seedance-2, maxLength 20000, read 2026-11-20).
export const SEEDANCE_LONG_PROMPT_MAX = 20_000;
export const SEEDANCE_LONG_FLAG = 'seedanceLongTemplates';

export const seedanceLongTemplatesOn = (env = process.env) => appRuntimeFlag(SEEDANCE_LONG_FLAG, env);

/** False only for the long-template offer while its switch is off; every other model is unaffected. */
export function seedanceLongModelOpen(modelId, env = process.env) {
    return modelId !== SEEDANCE_LONG_MODEL_ID || seedanceLongTemplatesOn(env);
}
