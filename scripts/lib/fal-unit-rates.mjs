// What fal's model page quotes for the catalog rows it prices per unit, and
// how the cost of one generation is built from it. The catalog records these
// rows per generation (cost_unit per_generation, no billing_seconds), so
// without this the weekly watch holds $0.036 against a page that says $0.0003.
// Rates read from fal's pages on 2026-10-09.
//
//   rate        the figure on fal's page, in dollars
//   per         the unit fal quotes it for
//   quantity    units one generation is billed: the pin or cap in
//               lib/modelCapabilities.js (tests/falPriceCheck.test.mjs holds
//               the two together), or what fal billed where that differs
//   multiplier  a surcharge the pinned request always carries
//
// When fal changes a price, change the rate here and correct the row's
// provider_cost_per_unit (and credits_5s if the floor moves) by migration.
export const UNIT_RATES = {
    // "$0.0002 per second of generated audio"; duration is pinned at 60.
    'ace-step': { rate: 0.0002, per: 's', quantity: 60 },
    // "$0.0003 per output second. Thinking-enabled requests run at 2x";
    // pinned at 60s with thinking on and one output.
    'ace-step-1.5': { rate: 0.0003, per: 's', quantity: 60, multiplier: 2 },
    // "$0.01 per 1000 character"; the text is capped at 2000.
    'inworld-tts': { rate: 0.01, per: '1k chars', quantity: 2 },
    // "$0.0562/second" of output, which is as long as the audio: capped at 10s.
    'kling-avatar-v2': { rate: 0.0562, per: 's', quantity: 10 },
    // "$0.001/second". The audio is pinned at 8s and fal billed 10s for it
    // (usage page, 2026-10-05; migration 0221), so 10 is what a job costs.
    'mmaudio-v2-video': { rate: 0.001, per: 's', quantity: 10 },
};

// fal's base price for each endpoint an active catalog row uses: the
// `endpointBilling` object in the model page's payload (billing_unit and
// price), read on 2026-10-09. Keyed by endpoint, as fal keys it.
//
// It is the price of one unit, not of one generation, and not always the
// figure in the page's sentence: Kling 3.0 image-to-video is 0.14 a second
// here against "$0.112 (audio off)", Bria background remove 0.018 against
// "$0.04 per image", Topaz 0.01 a megapixel against "$0.08 for up to 24MP".
// So the weekly watch never holds it against a catalog cost. It holds it
// against this copy of itself, exactly, and that covers the pages with no
// price sentence at all.
//
// When the watch reports one that moved: read the model page, work out what
// one generation costs now, correct the catalog row by migration if that
// changed, then record the new figure here (and in UNIT_RATES if the row is
// there; tests/falBasePrice.test.mjs holds the two together). A newly
// activated row prints "no base price recorded" with the figure to add.
export const BASE_PRICES = {
    'fal-ai/ace-step': { price: 0.0002, unit: 'seconds' },
    'fal-ai/ace-step-1.5': { price: 0.0003, unit: 'units' },
    'fal-ai/bria/background/remove': { price: 0.018, unit: 'generations' },
    'fal-ai/bria/expand': { price: 0.04, unit: 'generations' },
    'fal-ai/bytedance/seedream/v4/text-to-image': { price: 0.03, unit: 'images' },
    'fal-ai/elevenlabs/sound-effects/v2': { price: 0.002, unit: 'seconds' },
    'fal-ai/elevenlabs/text-to-dialogue/eleven-v3': { price: 0.1, unit: '1000 characters' },
    'fal-ai/elevenlabs/tts/turbo-v2.5': { price: 0.05, unit: '1000 characters' },
    'fal-ai/flux-2-pro': { price: 0.03, unit: 'processed megapixels' },
    'fal-ai/inworld-tts': { price: 0.01, unit: '1000 characters' },
    'fal-ai/kling-video/ai-avatar/v2/standard': { price: 0.0562, unit: 'seconds' },
    'fal-ai/kling-video/v3/pro/image-to-video': { price: 0.14, unit: 'seconds' },
    'fal-ai/latentsync': { price: 0.005, unit: 'seconds' },
    'fal-ai/minimax/speech-2.6-hd': { price: 0.1, unit: '1000 characters' },
    'fal-ai/mmaudio-v2': { price: 0.001, unit: 'seconds' },
    'fal-ai/mmaudio-v2/text-to-audio': { price: 0.001, unit: 'seconds' },
    'fal-ai/nano-banana-pro/edit': { price: 0.15, unit: 'images' },
    'fal-ai/sana/v1.5/4.8b': { price: 0.01, unit: 'megapixels' },
    'fal-ai/topaz/upscale/image': { price: 0.01, unit: 'megapixels' },
};
