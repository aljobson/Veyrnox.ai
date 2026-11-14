// The outer bound on `inputs.aspect_ratio` at the API boundary: every shape
// some model's capability record declares, and nothing else
// (tests/generationAspectRatios.test.mjs). A model's own record narrows it
// again before the debit, so a shape that model cannot make is still refused.
export const GENERATION_ASPECT_RATIOS = Object.freeze([
    '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', 'auto',
]);
