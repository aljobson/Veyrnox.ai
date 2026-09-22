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

const SPEAKER_LINE = /^\s*([\p{L}][\p{L}\p{N} .'-]{0,29}):\s*(.+)$/u;

/** @returns {{ok:true, blocks:{voice:string,text:string}[]}|{ok:false}} */
export function parseDialogue(script) {
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
                voiceOf.set(name, DIALOGUE_VOICES[voiceOf.size]);
            }
            blocks.push({ voice: voiceOf.get(name), text: m[2].trim() });
        } else if (blocks.length) {
            blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], text: `${blocks[blocks.length - 1].text} ${line}` };
        } else {
            blocks.push({ voice: DIALOGUE_VOICES[0], text: line });
        }
    }
    return blocks.length ? { ok: true, blocks } : { ok: false };
}
