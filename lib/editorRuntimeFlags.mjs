// Editor controls share one public binding to stay within the Worker limit.
const KEYS = Object.freeze({
    PROJECT_ODDLINGS_ENABLED: 'oddlings',
    EDITOR_LIBRARY_EXPORTS_ENABLED: 'libraryExports',
    EDITOR_ORGANIZATION_ENABLED: 'organization',
    EDITOR_LOCAL_INFERENCE_ENABLED: 'localInference',
    EDITOR_AUDIO_STEMS_ENABLED: 'audioStems',
    EDITOR_SCENES_ENABLED: 'scenes', // ADR-0105: absent from the production value, so off
    EDITOR_CLIPPER_ENABLED: 'clipper', // ADR-0105 slice C: same
    EDITOR_AGENT_ENABLED: 'agent', // ADR-0105 slice D: same
    EDITOR_SERVER_RENDER_ENABLED: 'serverRender', // ADR-0261: admission only
    EDITOR_SERVER_RENDER_RECOVERY_ENABLED: 'serverRenderRecovery', // independent rollback/recovery control
    EDITOR_AI_EDIT_ENABLED: 'aiEdit', // ADR-0330: absent from the production value, so off
    SPEECH_CUT_ENABLED: 'speechCut', // ADR-0331: same
});
// A catalog row id, not a switch: the model the typed AI edit may use (ADR-0330). Shares the one binding, because the Worker is at its text-binding cap.
const MODEL_KEY = 'aiEditModel';
const MODEL_VALUE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const allowedValue = (key, value) => key === MODEL_KEY ? typeof value === 'string' && MODEL_VALUE.test(value)
    : (key === 'serverRender' ? ['true', 'false', 'preview'] : ['true', 'false']).includes(value);
export function editorFeatureEnabled(name, env = process.env) {
    if (!Object.hasOwn(KEYS, name) || !env || typeof env !== 'object') return false;
    // An explicit legacy flag remains an independent rollback override.
    if (Object.hasOwn(env, name)) return env[name] === 'true';
    const raw = env.EDITOR_RUNTIME_FLAGS;
    if (typeof raw !== 'string' || raw.length > 1024) return false;
    try {
        const flags = JSON.parse(raw);
        if (!flags || typeof flags !== 'object' || Array.isArray(flags) ||
            Object.keys(flags).some(key => (key !== MODEL_KEY && !Object.values(KEYS).includes(key)) || !allowedValue(key, flags[key]))) return false;
        return flags[KEYS[name]] === 'true';
    } catch { return false; }
}

/** Admission mode only; status, cancellation and recovery are independent. */
export function editorServerRenderMode(env = process.env) {
    if (!env || typeof env !== 'object') return 'off';
    if (Object.hasOwn(env, 'EDITOR_SERVER_RENDER_ENABLED')) {
        const value = env.EDITOR_SERVER_RENDER_ENABLED;
        return value === 'true' ? 'on' : value === 'preview' ? 'preview' : 'off';
    }
    // Reuse the strict grouped validation, including unknown keys and types.
    if (editorFeatureEnabled('EDITOR_SERVER_RENDER_ENABLED', env)) return 'on';
    try {
        const flags = JSON.parse(env.EDITOR_RUNTIME_FLAGS);
        if (flags?.serverRender !== 'preview') return 'off';
        return editorFeatureEnabled('EDITOR_SERVER_RENDER_ENABLED', {
            ...env, EDITOR_RUNTIME_FLAGS: JSON.stringify({ ...flags, serverRender: 'true' }),
        }) && env.EDITOR_RUNTIME_FLAGS.length <= 1024 ? 'preview' : 'off';
    } catch { return 'off'; }
}

/** The catalog row the typed AI edit uses; '' when none is set. An explicit legacy env var is an independent override. */
export function editorAiEditModelId(env = process.env) {
    if (!env || typeof env !== 'object') return '';
    if (Object.hasOwn(env, 'EDITOR_AI_EDIT_MODEL_ID')) return typeof env.EDITOR_AI_EDIT_MODEL_ID === 'string' && MODEL_VALUE.test(env.EDITOR_AI_EDIT_MODEL_ID) ? env.EDITOR_AI_EDIT_MODEL_ID : '';
    const raw = env.EDITOR_RUNTIME_FLAGS;
    if (typeof raw !== 'string' || raw.length > 1024) return '';
    try {
        const flags = JSON.parse(raw);
        if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return '';
        // Reuse the strict grouped validation: one bad key or value turns everything off.
        if (Object.keys(flags).some(key => (key !== MODEL_KEY && !Object.values(KEYS).includes(key)) || !allowedValue(key, flags[key]))) return '';
        return typeof flags[MODEL_KEY] === 'string' ? flags[MODEL_KEY] : '';
    } catch { return ''; }
}
