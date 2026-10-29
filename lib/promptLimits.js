// Owner-approved service contract: generation models use this platform limit
// unless their capability record declares a smaller provider- or price-based
// ceiling. The registry is authoritative for those exceptions (including
// Wan, Kling 2.6, Hailuo, Nano Banana and speech models).
export const GENERATION_PROMPT_MAX = 30_000;

// A full inputs object may contain the prompt plus bounded options and URLs.
// This is measured with JSON.stringify().length in the generation route.
// JSON escaping can expand one accepted prompt character to six bytes
// (for example a control character becomes \\u0001). Keep the aggregate
// request guard comfortably above that worst case plus the other bounded inputs.
export const GENERATION_INPUTS_MAX_CHARS = 256 * 1024;
