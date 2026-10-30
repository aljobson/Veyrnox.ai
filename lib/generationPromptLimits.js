// One product contract for positive media-generation prompts. Keep this
// separate from speech/dialogue text and negative prompts: those inputs have
// their own provider and pricing limits.
export const GENERATION_PROMPT_MAX = 30_000;
export const NEGATIVE_PROMPT_MAX = 2_000;
