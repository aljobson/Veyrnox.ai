import type { SubmitRequest } from '../generationSubmit';
import { isSpeechModelId } from './model';
import { defaultSpeechSettings, speechContractFor } from './shared';
import { validateSpeech, type SpeechSettings } from './studio';

export function restoreSpeech(request: SubmitRequest): { modelId?: string; script: string; settings: SpeechSettings } | null {
    if (!isSpeechModelId(request?.modelId) || typeof request.prompt !== 'string' || !request.extraInputs) return null;
    const inputs = request.extraInputs;
    if (request.modelId === 'qwen3-tts' && Object.keys(inputs).some(key => !Object.hasOwn(speechContractFor(request.modelId)!.rules, key))) return null;
    const defaults = request.modelId === 'qwen3-tts' ? defaultSpeechSettings(request.modelId) : {} as Partial<SpeechSettings>;
    const settings = { ...defaults, voice: inputs.tts_voice, language: inputs.tts_language, emotion: inputs.tts_emotion ?? defaults.emotion,
        speed: inputs.tts_speed ?? defaults.speed, volume: inputs.tts_volume ?? defaults.volume, pitch: inputs.tts_pitch ?? defaults.pitch } as SpeechSettings;
    return validateSpeech(request.prompt, settings, request.modelId) ? null : { ...(request.modelId === 'qwen3-tts' ? { modelId: request.modelId } : {}), script: request.prompt, settings };
}
