// One product contract for positive media-generation prompts. Keep this
// separate from speech/dialogue text and negative prompts: those inputs have
// their own provider and pricing limits.
export const GENERATION_PROMPT_MAX = 30_000;
export const NEGATIVE_PROMPT_MAX = 2_000;
// Kling 3.0 image-to-video refuses long prompts. On production, jobs at or under
// 2,500 characters succeeded 21 of 21 (longest 2,077) and jobs over it failed 10 of 10
// (shortest failure 2,545). fal's real limit is NOT documented or confirmed: this is an
// inference from our own job history. Raise or lower it here, in one place, once a probe
// settles it. Templates are exact-prompt-only, so over-cap ones are refused, never trimmed.
export const KLING_V3_PROMPT_MAX = 2_500;
