// Alibaba qwen3-tts-flash non-dialect, single-word ids, pinned 2026-11-23.
// Only Cherry is proved through Crun; the remaining voices require staging proof.
export const QWEN_MODEL_ID = 'qwen3-tts';
export const QWEN_ENDPOINT = 'qwen3-tts/speech-synthesis';
export const QWEN_SCRIPT_LIMIT = 600;
export const QWEN_VOICES = [
    ['Cherry', 'female'], ['Serena', 'female'], ['Ethan', 'male'], ['Chelsie', 'female'],
    ['Momo', 'female'], ['Vivian', 'female'], ['Moon', 'male'], ['Maia', 'female'],
    ['Kai', 'male'], ['Nofish', 'male'], ['Bella', 'female'], ['Jennifer', 'female'],
    ['Ryan', 'male'], ['Katerina', 'female'], ['Aiden', 'male'], ['Mia', 'female'],
    ['Mochi', 'male'], ['Bellona', 'neutral'], ['Vincent', 'male'], ['Bunny', 'female'],
    ['Neil', 'male'], ['Elias', 'female'], ['Arthur', 'male'], ['Nini', 'female'],
    ['Seren', 'female'], ['Pip', 'male'], ['Stella', 'female'], ['Bodega', 'male'],
    ['Sonrisa', 'female'], ['Alek', 'male'], ['Dolce', 'male'], ['Sohee', 'female'],
    ['Lenn', 'male'], ['Emilien', 'male'], ['Andre', 'male'],
].map(([id, gender]) => Object.freeze({ id, label: id, gender }));
export const QWEN_LANGUAGES = ['auto', 'Chinese', 'English', 'German', 'Italian', 'Portuguese', 'Spanish', 'Japanese', 'Korean', 'French'];
export const QWEN_INPUT_RULES = {
    tts_voice: { type: 'enum', values: QWEN_VOICES.map(voice => voice.id) },
    tts_language: { type: 'enum', values: QWEN_LANGUAGES },
};
export const QWEN_CONTRACT = { scriptLimit: QWEN_SCRIPT_LIMIT, voices: QWEN_VOICES,
    languages: QWEN_LANGUAGES, rules: QWEN_INPUT_RULES, controls: [] };
export const QWEN_CAPABILITY = {
    provider: 'crun', kind: 'speech', strictInputs: true,
    inputs: { prompt: { type: 'string', max: QWEN_SCRIPT_LIMIT, required: true }, ...QWEN_INPUT_RULES },
    rename: {}, media: {}, lengths: null, fixed: {}, assumes: {}, speech: QWEN_CONTRACT,
};
