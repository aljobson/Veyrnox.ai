import { appRuntimeFlag } from './appRuntime.js';
export const seedance25Offer = id => id === 'seedance-2.5-edit' || id === 'seedance-2.5-extend';
export const seedance25Open = (id, env = process.env) => !seedance25Offer(id) || appRuntimeFlag('seedance25', env);
// Raw client controls, before media URLs are discarded or declaredInputs filters them.
export function seedance25RawRefusal(id, inputs) {
    if (!seedance25Offer(id)) return null;
    const allowed = new Set(['prompt', ...(id.endsWith('-extend') ? ['duration_seconds'] : [])]);
    for (const key of Object.keys(inputs || {})) {
        if (!allowed.has(key)) return `inputs_key_not_allowed:${key.slice(0, 32)}`;
    }
    if (inputs.duration_seconds !== undefined && inputs.duration_seconds !== 5) return 'duration_not_supported';
    if (typeof inputs.prompt !== 'string' || !inputs.prompt.trim() || inputs.prompt.length > 30000) return 'inputs_invalid:prompt';
    return null;
}
// Billing and upper bounds use conservative container seconds (including longer audio).
// checkSource enforces the 4-second minimum using picture/videoSeconds before this function.
// Extend proof used a 5.055s source; raising its 6s cap requires a billed longer-source proof.
// Only measured metadata from resolveGenerationSources belongs here. Never accept client seconds.
export function seedance25Bill(id, unitCredits, sources) {
    if (!seedance25Offer(id)) return { ok: false, error: 'model_not_found' };
    const source = sources?.video_url;
    if (!source || Array.isArray(source)) return { ok: false, error: 'source_count_exceeded' };
    const seconds = source.seconds;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return { ok: false, error: 'source_length_unknown' };
    if (seconds < 4) return { ok: false, error: 'source_too_short' };
    const edit = id === 'seedance-2.5-edit';
    if (seconds > (edit ? 10 : 6)) return { ok: false, error: 'source_too_long' };
    if (!Number.isSafeInteger(unitCredits) || unitCredits <= 0) return { ok: false, error: 'catalog_price_invalid' };
    const units = edit ? Math.ceil(seconds / 5) : 1;
    return { ok: true, basis: edit ? 'source_seconds' : 'output_seconds', source_seconds: seconds,
        billable_seconds: edit ? seconds : 5, units, credits: unitCredits * units };
}
