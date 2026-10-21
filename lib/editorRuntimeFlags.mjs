// Eight editor controls share one public binding to stay within the Worker limit.
const KEYS = Object.freeze({
    PROJECT_ODDLINGS_ENABLED: 'oddlings',
    EDITOR_LIBRARY_EXPORTS_ENABLED: 'libraryExports',
    EDITOR_ORGANIZATION_ENABLED: 'organization',
    EDITOR_LOCAL_INFERENCE_ENABLED: 'localInference',
    EDITOR_AUDIO_STEMS_ENABLED: 'audioStems',
    EDITOR_SCENES_ENABLED: 'scenes', // ADR-0105: absent from the production value, so off
    EDITOR_CLIPPER_ENABLED: 'clipper', // ADR-0105 slice C: same
    EDITOR_AGENT_ENABLED: 'agent', // ADR-0105 slice D: same
});
export function editorFeatureEnabled(name, env = process.env) {
    if (!Object.hasOwn(KEYS, name) || !env || typeof env !== 'object') return false;
    // An explicit legacy flag remains an independent rollback override.
    if (Object.hasOwn(env, name)) return env[name] === 'true';
    const raw = env.EDITOR_RUNTIME_FLAGS;
    if (typeof raw !== 'string' || raw.length > 1024) return false;
    try {
        const flags = JSON.parse(raw);
        if (!flags || typeof flags !== 'object' || Array.isArray(flags) ||
            Object.keys(flags).some(key => !Object.values(KEYS).includes(key) || !['true', 'false'].includes(flags[key]))) return false;
        return flags[KEYS[name]] === 'true';
    } catch { return false; }
}
