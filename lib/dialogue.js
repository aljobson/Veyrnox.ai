/**
 * ElevenLabs dialogue: the prompt is a script, one line per speaker —
 *
 *   Ana: Did you hear that?
 *   Ben: [whispers] Stay quiet.
 *
 * Each new speaker name takes the next voice below, in order of first
 * appearance. A line with no "Name:" continues the previous speaker (the
 * first speaker if it opens the script). Pure; the gateway uses it both to
 * refuse a bad script before the debit and to build the provider request.
 */

// ElevenLabs stock voices on fal's eleven-v3 endpoint, alternating so two
// speakers always sound different.
export const DIALOGUE_VOICES = ['Aria', 'Roger', 'Sarah', 'George'];
export const DIALOGUE_VOICE_INPUTS = ['dialogue_voice_1', 'dialogue_voice_2', 'dialogue_voice_3', 'dialogue_voice_4'];

/**
 * Turn the optional first-appearance voice inputs into one complete, distinct
 * provider order. Gaps, duplicates and unknown voices are refused rather than
 * silently changing the cast a person approved.
 */
export function dialogueVoiceOrder(inputs = {}) {
    const requested = [];
    let foundGap = false;
    for (const key of DIALOGUE_VOICE_INPUTS) {
        const value = inputs && inputs[key];
        if (value === undefined) {
            foundGap = true;
            continue;
        }
        if (foundGap || !DIALOGUE_VOICES.includes(value) || requested.includes(value)) return null;
        requested.push(value);
    }
    return [...requested, ...DIALOGUE_VOICES.filter((voice) => !requested.includes(voice))];
}

const SPEAKER_LINE = /^\s*([\p{L}][\p{L}\p{N} .'-]{0,29}):\s*(.+)$/u;

/** @returns {{ok:true, blocks:{voice:string,text:string}[]}|{ok:false}} */
export function parseDialogue(script, voices = DIALOGUE_VOICES) {
    if (!Array.isArray(voices) || voices.length !== DIALOGUE_VOICES.length
        || new Set(voices).size !== DIALOGUE_VOICES.length
        || voices.some((voice) => !DIALOGUE_VOICES.includes(voice))) return { ok: false };
    const voiceOf = new Map();
    const blocks = [];
    for (const raw of String(script || '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const m = SPEAKER_LINE.exec(line);
        if (m) {
            const name = m[1].trim().toLowerCase();
            if (!voiceOf.has(name)) {
                if (voiceOf.size === DIALOGUE_VOICES.length) return { ok: false };
                voiceOf.set(name, voices[voiceOf.size]);
            }
            blocks.push({ voice: voiceOf.get(name), text: m[2].trim() });
        } else if (blocks.length) {
            blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], text: `${blocks[blocks.length - 1].text} ${line}` };
        } else {
            blocks.push({ voice: voices[0], text: line });
        }
    }
    return blocks.length ? { ok: true, blocks } : { ok: false };
}
