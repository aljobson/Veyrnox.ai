import type { SubmitRequest } from '../generationSubmit';
import { SPEECH_MODEL_ID } from './model';
import { validateSpeech, type SpeechSettings } from './studio';

export function restoreSpeech(request: SubmitRequest): { script: string; settings: SpeechSettings } | null {
    if (request?.modelId !== SPEECH_MODEL_ID || typeof request.prompt !== 'string' || !request.extraInputs) return null;
    const inputs = request.extraInputs;
    const settings = { voice: inputs.tts_voice, language: inputs.tts_language, emotion: inputs.tts_emotion,
        speed: inputs.tts_speed, volume: inputs.tts_volume, pitch: inputs.tts_pitch } as SpeechSettings;
    return validateSpeech(request.prompt, settings) ? null : { script: request.prompt, settings };
}
