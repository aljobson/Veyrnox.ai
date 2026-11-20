// One product contract for positive media-generation prompts. Keep this
// separate from speech/dialogue text and negative prompts: those inputs have
// their own provider and pricing limits.
export const GENERATION_PROMPT_MAX = 30_000;
export const NEGATIVE_PROMPT_MAX = 2_000;
// Kling 3.0 image-to-video refuses long prompts. fal's published schema gives prompt maxLength 2500
// (https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/kling-video/v3/pro/image-to-video, read 2026-11-20),
// matching production history: jobs at or under 2,500 characters succeeded 21 of 21 and jobs over it failed 10 of 10.
// If fal changes the schema, raise or lower it here, in one place. Templates are exact-prompt-only, so over-cap ones are
// refused, never trimmed.
export const KLING_V3_PROMPT_MAX = 2_500;
