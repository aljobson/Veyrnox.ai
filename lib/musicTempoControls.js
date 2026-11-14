// Tempo, key and time signature for an ACE-Step 1.5 Simple quote (0514). Each maps
// 1:1 to a documented fal input (bpm, key_scale, time_signature); absent means the
// provider chooses. The SQL quote enforces the same rules.

export const MUSIC_BPM_MIN = 40;
export const MUSIC_BPM_MAX = 220;
export const MUSIC_KEY_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const MUSIC_KEY_SCALES = MUSIC_KEY_NOTES.flatMap((note) => [`${note} Major`, `${note} Minor`]);
export const MUSIC_TIME_SIGNATURES = [
    { value: '4', label: '4/4' },
    { value: '3', label: '3/4' },
    { value: '6', label: '6/8' },
    { value: '2', label: '2/4' },
];
export const MUSIC_TEMPO_KEYS = ['bpm', 'key_scale', 'time_signature'];

/**
 * @param {Record<string, unknown>} value  the quote body
 * @returns {{ ok: true, bpm: number|null, keyScale: string|null, timeSignature: string|null, used: boolean } | { ok: false, error: string }}
 */
export function parseMusicTempoControls(value) {
    const bpm = value.bpm ?? null;
    const keyScale = value.key_scale ?? null;
    const timeSignature = value.time_signature ?? null;
    if (bpm !== null && (!Number.isInteger(bpm) || bpm < MUSIC_BPM_MIN || bpm > MUSIC_BPM_MAX)) {
        return { ok: false, error: 'bpm_invalid' };
    }
    if (keyScale !== null && !MUSIC_KEY_SCALES.includes(keyScale)) return { ok: false, error: 'key_scale_invalid' };
    if (timeSignature !== null && !MUSIC_TIME_SIGNATURES.some((item) => item.value === timeSignature)) {
        return { ok: false, error: 'time_signature_invalid' };
    }
    return { ok: true, bpm, keyScale, timeSignature, used: bpm !== null || keyScale !== null || timeSignature !== null };
}
