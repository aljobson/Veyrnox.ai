import { parseDialogue, DIALOGUE_VOICES } from './dialogue.js';

// Separate KIE offering: James, Arabella, Bradford and Xavier, in first-speaker
// order. These are documented IDs, not the existing fal route's voice identities.
export const KIE_DIALOGUE_VOICES = Object.freeze([
    'EkK5I93UQWFDigLMpZcX', 'Z3R5wn05IrDiVCyEkUrK',
    'NNl6r8mD7vthiJatiJt1', 'YOq2y2Up4RgXP2HyXjE5',
]);

export function buildKieDialogue(prompt) {
    if (typeof prompt !== 'string' || prompt.length > 1000) return { ok: false };
    const parsed = parseDialogue(prompt);
    if (!parsed.ok) return parsed;
    return { ok: true, dialogue: parsed.blocks.map(({ text, voice }) => ({
        text, voice: KIE_DIALOGUE_VOICES[DIALOGUE_VOICES.indexOf(voice)],
    })) };
}
