// Keep in parity with lib/generationPromptLimits.js. Mobile cannot import the
// web/server module across the app package boundary at runtime.
export const GENERATION_PROMPT_MAX = 30_000;
export const NEGATIVE_PROMPT_MAX = 2_000;
