import { parseWordJson } from './editorWords.mjs';
/** Only real model word timestamps become timed words. Missing, overlapping or empty intervals are refused. */
export function speechResultCaptions(result, seconds) {
    if (!result || typeof result.text !== 'string' || !Array.isArray(result.chunks) || result.chunks.length > 3000 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 120) return { error: 'The recognition result has no valid word timings.' };
    if (!result.chunks.length || !result.text.trim()) return { error: 'No speech was recognized. Try clearer audio or use manual captions.' };
    const words = []; let previous = 0;
    for (const chunk of result.chunks) {
        const times = chunk?.timestamp;
        if (typeof chunk?.text !== 'string' || !chunk.text.trim() || chunk.text.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(chunk.text) || !Array.isArray(times) || times.length !== 2 || !times.every(Number.isFinite) || times[0] < 0 || times[0] < previous - 1e-6 || times[1] <= times[0] || times[1] > seconds + 1 / 30) return { error: 'The model returned missing or overlapping word timings. Retry with clearer audio or use manual captions.' };
        const start = Math.round(times[0] * 30), end = Math.min(Math.round(seconds * 30), Math.round(times[1] * 30));
        if (end <= start) return { error: 'A recognized word is shorter than one editor frame. Review the timed transcript before importing.' };
        words.push({ word: chunk.text.trim(), start: start / 30, end: end / 30 }); previous = times[1];
    }
    return parseWordJson(JSON.stringify({ words }));
}
