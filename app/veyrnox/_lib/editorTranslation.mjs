// Browser-owned translation models never receive audio or upload caption text.
const language = value => typeof value === 'string' && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/i.test(value);
const abort = signal => { if (signal?.aborted) throw new DOMException('Translation cancelled.', 'AbortError'); };
export function translationProblem(cues, sourceLanguage, targetLanguage) {
    if (!language(sourceLanguage) || !language(targetLanguage)) return 'Choose valid source and target languages.';
    if (sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()) return 'Choose a different target language.';
    if (!Array.isArray(cues) || !cues.length || cues.length > 150 || cues.some(c => !c || typeof c.text !== 'string' || !c.text.trim() || c.text.length > 1000 || !Number.isInteger(c.start) || c.start < 0 || !Number.isInteger(c.len) || c.len < 1 || c.start + c.len > 18000)) return 'Choose up to 150 valid timed captions.';
    if (cues.reduce((sum, c) => sum + c.text.length, 0) > 24000) return 'Translate fewer caption lines at once.';
    return null;
}
export async function translationAvailability(sourceLanguage, targetLanguage, runtime = globalThis.Translator) {
    if (!language(sourceLanguage) || !language(targetLanguage) || !runtime?.availability || !runtime?.create) return 'unavailable';
    try { return await runtime.availability({ sourceLanguage, targetLanguage }); } catch { return 'unavailable'; }
}
/** Call directly from the Translate click, so creation retains browser user activation. Results are atomic. */
export async function translateCaptionCues(cues, { sourceLanguage, targetLanguage, signal, onProgress = () => {}, runtime = globalThis.Translator } = {}) {
    const problem = translationProblem(cues, sourceLanguage, targetLanguage);
    if (problem) throw new Error(problem);
    if (!runtime?.create) throw new Error('On-device translation is unavailable in this browser. Use a supported desktop browser.');
    abort(signal);
    const snapshot = cues.map(c => ({ ...c }));
    let translator, destroyed = false;
    const destroy = () => { if (translator && !destroyed) { destroyed = true; translator.destroy(); } };
    signal?.addEventListener('abort', destroy, { once: true });
    try {
        translator = await runtime.create({ sourceLanguage, targetLanguage, signal, monitor(monitor) { monitor.addEventListener('downloadprogress', event => { if (!signal?.aborted) onProgress({ stage: 'model', fraction: Math.min(1, Math.max(0, event.loaded)) }); }); } });
        abort(signal);
        const result = [];
        for (let i = 0; i < snapshot.length; i++) {
            abort(signal);
            const text = await translator.translate(snapshot[i].text, { signal });
            abort(signal);
            if (typeof text !== 'string' || !text.trim() || text.length > 1000 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)) throw new Error('A translated caption is too long or invalid. Translate fewer words in this line.');
            const translated = { ...snapshot[i], text: text.trim() };
            // Word alignment belongs to the source language. Cue timing and visual style remain valid.
            delete translated.words; delete translated.wordsEstimated; delete translated.wordStyle;
            result.push(translated);
            if (result.reduce((sum, cue) => sum + cue.text.length, 0) > 24000) throw new Error('The translated captions are too large for one project.');
            onProgress({ stage: 'translation', fraction: (i + 1) / snapshot.length });
        }
        return result;
    } finally { signal?.removeEventListener('abort', destroy); destroy(); }
}
