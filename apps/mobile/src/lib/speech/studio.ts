import type { SubmitRequest } from '../generationSubmit';
import { estimateCredits, type CatalogModel } from '../media';
import { appendSpeechCue, speechContractFor, TTS_CONTROL_STEPS, TTS_SCRIPT_LIMIT, ttsGenerationInputs, type SpeechSettings } from './shared';
export type { SpeechSettings } from './shared';

export function validateSpeech(script: string, settings: SpeechSettings, modelId = 'minimax-speech-2.6-hd'): string | null {
    const contract = speechContractFor(modelId);
    if (!contract) return 'speech.invalidSettings';
    if (!script.trim()) return 'speech.required';
    if (script.length > contract.scriptLimit) return modelId === 'qwen3-tts' ? 'speech.qwen.tooLong' : 'speech.tooLong';
    const inputs = ttsGenerationInputs(settings, modelId);
    for (const key of Object.keys(contract.rules) as (keyof typeof inputs)[]) {
        const rule = contract.rules[key], value = inputs[key];
        if (rule.type === 'enum') {
            if (typeof value !== 'string' || !rule.values.includes(value)) return 'speech.invalidSettings';
        } else if (typeof value !== 'number' || !Number.isFinite(value) || value < rule.min || value > rule.max
            || (rule.type === 'int' && !Number.isInteger(value))) return 'speech.invalidSettings';
    }
    // The JS seam coerces numbers for the web. The native contract requires actual numbers.
    if (contract.controls.filter(key => ['speed', 'volume', 'pitch'].includes(key)).some(key => typeof settings[key as keyof SpeechSettings] !== 'number')) return 'speech.invalidSettings';
    return null;
}
export function stepSpeechValue(key: 'speed' | 'volume' | 'pitch', value: number, direction: -1 | 1, modelId = 'minimax-speech-2.6-hd'): number {
    const rule = speechContractFor(modelId)?.rules[`tts_${key}`];
    if (!rule) return value;
    if (rule.type === 'enum') return value;
    const next = Math.round((value + direction * TTS_CONTROL_STEPS[key]) * 10) / 10;
    return Math.min(rule.max, Math.max(rule.min, next));
}
export function buildSpeechRequest(script: string, settings: SpeechSettings, model: CatalogModel): SubmitRequest {
    const error = validateSpeech(script, settings, model.id);
    if (error) throw new Error(error);
    return { modelId: model.id, prompt: script.trim(), extraInputs: ttsGenerationInputs(settings, model.id),
        durationSeconds: null, confirmedCredits: estimateCredits(model, null), analyticsKind: 'audio' };
}
export function insertCue(script: string, cue: string, limit = TTS_SCRIPT_LIMIT): { script: string; tooLong: boolean } {
    const trimmed = script.trim();
    if (trimmed.length + (trimmed ? 1 : 0) + cue.length > limit) return { script, tooLong: true };
    return { script: appendSpeechCue(trimmed, cue, limit), tooLong: false };
}
