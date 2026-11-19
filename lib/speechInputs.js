import { DIALOGUE_VOICES, DIALOGUE_VOICE_INPUTS } from './dialogue.js';

// Server contract for the web studios; tests pin these lists to the client exports.
export const TTS_VOICE_IDS = [
    'Wise_Woman', 'Friendly_Person', 'Inspirational_girl', 'Deep_Voice_Man',
    'Calm_Woman', 'Casual_Guy', 'Lively_Girl', 'Patient_Man', 'Young_Knight',
    'Determined_Man', 'Lovely_Girl', 'Decent_Boy', 'Imposing_Manner', 'Elegant_Man',
    'Abbess', 'Sweet_Girl_2', 'Exuberant_Girl',
];
export const TTS_LANGUAGE_VALUES = [
    'auto', 'English', 'Chinese', 'Chinese,Yue', 'Japanese', 'Korean', 'Spanish', 'Portuguese',
    'French', 'Indonesian', 'German', 'Russian', 'Italian', 'Dutch', 'Vietnamese', 'Arabic',
    'Turkish', 'Ukrainian',
];
export const TTS_EMOTION_VALUES = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'fearful', 'disgusted'];

// `hidden`: studio-only controls; /api/catalog omits them so model pages and the phone do not list them as facts.
export const TTS_INPUT_RULES = {
    tts_voice: { type: 'enum', values: TTS_VOICE_IDS, hidden: true },
    tts_emotion: { type: 'enum', values: TTS_EMOTION_VALUES, hidden: true },
    tts_speed: { type: 'number', min: 0.5, max: 2, hidden: true },
    tts_volume: { type: 'number', min: 0, max: 10, hidden: true },
    tts_pitch: { type: 'int', min: -12, max: 12, hidden: true },
    tts_language: { type: 'enum', values: TTS_LANGUAGE_VALUES, hidden: true },
};
export const DIALOGUE_INPUT_RULES = Object.fromEntries(
    DIALOGUE_VOICE_INPUTS.map(key => [key, { type: 'enum', values: DIALOGUE_VOICES, hidden: true }]),
);
export const SPEECH_CONTROL_KEYS = [...Object.keys(TTS_INPUT_RULES), ...DIALOGUE_VOICE_INPUTS];

/** Build only supplied controls, preserving provider defaults for omitted fields. */
export function speechVoiceSettings(inputs) {
    const voice = {};
    for (const [key, field] of [
        ['tts_voice', 'voice_id'], ['tts_speed', 'speed'], ['tts_volume', 'vol'],
        ['tts_pitch', 'pitch'], ['tts_emotion', 'emotion'],
    ]) {
        if (inputs[key] !== undefined) {
            // ADR-0365: the studio allows 0, but fal's minimum volume is 0.01.
            voice[field] = key === 'tts_volume' ? Math.max(0.01, inputs[key]) : inputs[key];
        }
    }
    return {
        ...(Object.keys(voice).length ? { voice_setting: voice } : {}),
        ...(inputs.tts_language !== undefined ? { language_boost: inputs.tts_language } : {}),
    };
}
