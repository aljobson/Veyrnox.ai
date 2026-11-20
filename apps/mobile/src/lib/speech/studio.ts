import type { SubmitRequest } from '../generationSubmit';
import { estimateCredits, type CatalogModel } from '../media';
import { appendSpeechCue, TTS_CONTROL_STEPS, TTS_INPUT_RULES, TTS_SCRIPT_LIMIT, ttsGenerationInputs, type SpeechSettings } from './shared';
export type { SpeechSettings } from './shared';

export function validateSpeech(script: string, settings: SpeechSettings): string | null {
    if (!script.trim()) return 'speech.required';
    if (script.length > TTS_SCRIPT_LIMIT) return 'speech.tooLong';
    const inputs = ttsGenerationInputs(settings);
    for (const key of Object.keys(TTS_INPUT_RULES) as (keyof typeof inputs)[]) {
        const rule = TTS_INPUT_RULES[key], value = inputs[key];
        if (rule.type === 'enum') {
            if (typeof value !== 'string' || !rule.values.includes(value)) return 'speech.invalidSettings';
        } else if (typeof value !== 'number' || !Number.isFinite(value) || value < rule.min || value > rule.max
            || (rule.type === 'int' && !Number.isInteger(value))) return 'speech.invalidSettings';
    }
    // The JS seam coerces numbers for the web. The native contract requires actual numbers.
    if (['speed', 'volume', 'pitch'].some(key => typeof settings[key as keyof SpeechSettings] !== 'number')) return 'speech.invalidSettings';
    return null;
}
export function stepSpeechValue(key: 'speed' | 'volume' | 'pitch', value: number, direction: -1 | 1): number {
    const rule = TTS_INPUT_RULES[`tts_${key}`];
    if (rule.type === 'enum') return value;
    const next = Math.round((value + direction * TTS_CONTROL_STEPS[key]) * 10) / 10;
    return Math.min(rule.max, Math.max(rule.min, next));
}
export function buildSpeechRequest(script: string, settings: SpeechSettings, model: CatalogModel): SubmitRequest {
    const error = validateSpeech(script, settings);
    if (error) throw new Error(error);
    return { modelId: model.id, prompt: script.trim(), extraInputs: ttsGenerationInputs(settings),
        durationSeconds: null, confirmedCredits: estimateCredits(model, null), analyticsKind: 'audio' };
}
export function insertCue(script: string, cue: string): { script: string; tooLong: boolean } {
    const trimmed = script.trim();
    if (trimmed.length + (trimmed ? 1 : 0) + cue.length > TTS_SCRIPT_LIMIT) return { script, tooLong: true };
    return { script: appendSpeechCue(trimmed, cue), tooLong: false };
}
