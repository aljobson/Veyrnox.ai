// Typed seam over the web studio and server contract; Metro watches both shared directories.
// @ts-ignore shared plain JavaScript
import * as web from '../../../../../app/veyrnox/_lib/textToSpeech.js';
// @ts-ignore shared plain JavaScript
import * as auditions from '../../../../../app/veyrnox/_lib/voiceAuditions.js';
// @ts-ignore shared plain JavaScript (its only dependency, dialogue.js, is also pure)
import * as server from '../../../../../lib/speechInputs.js';

export interface SpeechSettings {
    voice: string; language: string; emotion: string; speed: number; volume: number; pitch: number;
}
export interface SpeechVoice { id: string; label: string; tone?: string; gender: string; age?: string }
export type SpeechInputs = { tts_voice: string; tts_language: string; tts_emotion?: string; tts_speed?: number; tts_volume?: number; tts_pitch?: number };
export type InputRule = { type: 'enum'; values: readonly string[]; hidden?: boolean }
    | { type: 'number' | 'int'; min: number; max: number; hidden?: boolean };
const shared = web as unknown as {
    TTS_SCRIPT_LIMIT: number; TTS_VOICES: readonly (SpeechVoice & { tone: string; age: string })[];
    voiceGenderOptions: (voices?: readonly SpeechVoice[]) => string[];
    TTS_LANGUAGES: readonly string[]; TTS_EMOTIONS: readonly string[]; TTS_PAUSES: readonly number[];
    TTS_INTERJECTIONS: readonly (readonly [string, string])[];
    DEFAULT_TTS_SETTINGS: Readonly<SpeechSettings>; TTS_EXAMPLES: readonly { title: string; text: string }[];
    appendSpeechCue: (script: string, cue: string, limit?: number) => string;
    pauseCue: (seconds: number) => string; ttsGenerationInputs: (settings: SpeechSettings, modelId?: string) => SpeechInputs;
    voiceAuditionScript: (limit?: number) => string;
};
export const { TTS_SCRIPT_LIMIT, TTS_VOICES, voiceGenderOptions, TTS_LANGUAGES, TTS_EMOTIONS, TTS_PAUSES,
    TTS_INTERJECTIONS, DEFAULT_TTS_SETTINGS, TTS_EXAMPLES, appendSpeechCue, pauseCue, ttsGenerationInputs, voiceAuditionScript } = shared;
export const { MIN_AUDITION_VOICES, MAX_AUDITION_VOICES, normalizeAuditionVoices, toggleAuditionVoice, auditionCost } = auditions as unknown as {
    MIN_AUDITION_VOICES: number; MAX_AUDITION_VOICES: number;
    normalizeAuditionVoices: (value: unknown) => string[];
    toggleAuditionVoice: (value: readonly string[], voice: string) => string[];
    auditionCost: (unit: number, voices: readonly string[]) => number;
};
export const TTS_INPUT_RULES = server.TTS_INPUT_RULES as Record<keyof SpeechInputs, InputRule>;

// Native steppers match TextToSpeechControls.js on the web.
export const TTS_CONTROL_STEPS = { speed: 0.1, volume: 1, pitch: 1 } as const;

export interface SpeechContract {
    scriptLimit: number; voices: readonly SpeechVoice[]; languages: readonly string[];
    rules: Record<string, InputRule>; controls: readonly string[];
}
export const speechContractFor = server.speechContractFor as (modelId: string) => SpeechContract | null;
export function defaultSpeechSettings(modelId: string): SpeechSettings {
    // Retain the native shape for MiniMax steppers; the Qwen serializer emits only its two supported controls.
    return { ...DEFAULT_TTS_SETTINGS, ...(web.defaultSpeechSettings(modelId) as Partial<SpeechSettings>) };
}
