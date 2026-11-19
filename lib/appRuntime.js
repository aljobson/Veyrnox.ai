// App-wide on/off switches kept in one JSON binding, APP_RUNTIME_FLAGS, because the
// production Worker is at its 128 text-binding cap (ADR-0113 amendment 1).
// templateFaceWording is the dark photo-template provider wording gate and templateSwap the swap switch (ADR-0351).
// A key is on only when its value is exactly true; a missing or malformed binding means off.
function flags(env) {
    try {
        const parsed = JSON.parse(env?.APP_RUNTIME_FLAGS || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

export const appRuntimeFlag = (key, env = process.env) => flags(env)[key] === true;
// One swap switch (ADR-0351 amendment 9): the templateSwap runtime key, or the older TEMPLATE_SWAP_CLIP_ENABLED var when present.
export const templateSwapSwitchOn = (env = process.env) => env?.TEMPLATE_SWAP_CLIP_ENABLED === 'true' || appRuntimeFlag('templateSwap', env);
