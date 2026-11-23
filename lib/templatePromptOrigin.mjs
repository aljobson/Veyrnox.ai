// Where a template's exact prompt came from. Both origins run byte-exact through the fidelity contract; only the
// community one is a captured source, so public copy that says "community" must keep checking for it alone.
export const COMMUNITY_PROMPT_ORIGIN = 'community-source-exact';
export const ORIGINAL_SEEDANCE_ORIGIN = 'veyrnox-original';

export const hasExactPromptOrigin = (origin) => origin === COMMUNITY_PROMPT_ORIGIN || origin === ORIGINAL_SEEDANCE_ORIGIN;
