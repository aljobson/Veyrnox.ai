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
