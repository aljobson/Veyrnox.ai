// Shared boundary contract. Trim only: never paraphrase or feed exact words back
// through a planner. Length uses UTF-16 units, matching textarea maxLength.
export const MAX_NARRATION_LENGTH = 300;
const CONTROLS = /[\u0000-\u001F\u007F-\u009F]/;
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export function normaliseNarration(value) {
    if (value === undefined) return { ok: true, text: '' };
    if (typeof value !== 'string' || value.length > MAX_NARRATION_LENGTH || CONTROLS.test(value) || UNPAIRED_SURROGATE.test(value)) {
        return { ok: false, error: 'inputs_invalid:narration_text' };
    }
    return { ok: true, text: value.trim() };
}
