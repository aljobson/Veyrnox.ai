import { type createGenerationSubmit, type SubmitRequest } from '../generationSubmit';
import { plural } from '../i18n';
import type { CatalogModel } from '../media';
import { MIN_AUDITION_VOICES, MAX_AUDITION_VOICES, normalizeAuditionVoices, ttsGenerationInputs, type SpeechSettings } from './shared';
import { buildSpeechRequest, validateSpeech } from './studio';

export function validateAudition(script: string, settings: SpeechSettings, voices: readonly string[]): string | null {
    if (voices.length < MIN_AUDITION_VOICES || voices.length > MAX_AUDITION_VOICES
        || normalizeAuditionVoices(voices).length !== voices.length) return 'speech.audition.invalidVoices';
    return validateSpeech(script, { ...settings, voice: voices[0] });
}

export function buildAuditionRequest(script: string, settings: SpeechSettings, voices: readonly string[], model: CatalogModel): SubmitRequest {
    const error = validateAudition(script, settings, voices);
    if (error) throw new Error(error);
    // Only board voices are submitted; the single-voice picker must not change retry identity.
    return { ...buildSpeechRequest(script, { ...settings, voice: voices[0] }, model),
        inputsByIndex: voices.map(voice => ttsGenerationInputs({ ...settings, voice })) };
}

export function auditionQuote(submit: Pick<ReturnType<typeof createGenerationSubmit>, 'snapshot'>, request: SubmitRequest, unit: number) {
    return submit.snapshot(request, request.inputsByIndex?.length ?? 0, unit, 0);
}

export function auditionBatchNote(started: number, voices: readonly string[], uncertain = false): string {
    if (voices.length < MIN_AUDITION_VOICES) return '';
    return plural(uncertain ? 'speech.audition.uncertain' : 'speech.audition.stopped', voices.length,
        { started, next: started + 1 });
}
