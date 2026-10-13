import { LOCAL_SPEECH_WORKER_URL } from './localSpeechAssets.mjs';
import { SPEECH_LIMITS, timelineSpeechPCM, speechSelection } from './editorSpeechAudio.mjs';
import { speechResultCaptions } from './editorSpeechTiming.mjs';
export const SPEECH_LANGUAGES = Object.freeze([['english','English'],['spanish','Spanish'],['french','French'],['german','German'],['italian','Italian'],['portuguese','Portuguese'],['japanese','Japanese'],['korean','Korean'],['chinese','Chinese'],['hindi','Hindi'],['arabic','Arabic']]);
const aborted = () => new DOMException('Local automatic captions cancelled.', 'AbortError');
export function localSpeechAvailable(runtime = globalThis) {
    return typeof runtime.Worker === 'function' && typeof runtime.WebAssembly?.validate === 'function' && typeof runtime.crypto?.subtle?.digest === 'function';
}
/** The Worker receives PCM only, never source URLs, credentials or project metadata. */
export function recognizeSpeechPCM(audio, { language = 'english', signal, onProgress = () => {}, WorkerClass = globalThis.Worker, timeoutMs = 20 * 60 * 1000 } = {}) {
    if (!(audio instanceof Float32Array) || !audio.length || audio.length > SPEECH_LIMITS.samples || audio.some(n => !Number.isFinite(n) || Math.abs(n) > 1)) return Promise.reject(new Error('Choose valid decoded audio up to two minutes.'));
    if (!SPEECH_LANGUAGES.some(([code]) => code === language)) return Promise.reject(new Error('Choose a supported recognition language.'));
    if (signal?.aborted) return Promise.reject(aborted());
    if (typeof WorkerClass !== 'function') return Promise.reject(new Error('Local automatic captions need a browser with module Workers and WebAssembly.'));
    let energy = 0; for (const sample of audio) energy += sample * sample;
    if (Math.sqrt(energy / audio.length) < .00001) return Promise.reject(new Error('The audible edit is silent. Unmute a speech track or use manual captions.'));
    const seconds = audio.length / SPEECH_LIMITS.sampleRate;
    return new Promise((resolve, reject) => {
        let worker, timer, settled = false;
        const cleanup = () => { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', cancel); worker?.terminate(); };
        const finish = (error, result) => { if (settled) return; settled = true; cleanup(); if (error) reject(error); else resolve(result); };
        const cancel = () => finish(aborted());
        try {
            worker = new WorkerClass(LOCAL_SPEECH_WORKER_URL, { type: 'module', name: 'veyrnox-local-captions' });
            worker.onmessage = event => {
                if (settled) return;
                const message = event.data;
                if (message?.stage === 'error') finish(new Error(typeof message.message === 'string' ? message.message.slice(0, 300) : 'Local recognition failed.'));
                else if (message?.stage === 'result') {
                    const parsed = speechResultCaptions(message.result, seconds);
                    finish(parsed.error ? new Error(parsed.error) : null, parsed.cues);
                } else if (['model', 'recognition'].includes(message?.stage)) onProgress({ stage: message.stage, fraction: Number.isFinite(message.fraction) ? Math.max(0, Math.min(1, message.fraction)) : null });
            };
            worker.onerror = () => finish(new Error('The local speech model could not run in this browser. Use manual captions or a supported desktop browser.'));
            worker.onmessageerror = () => finish(new Error('The local speech result could not be read.'));
            signal?.addEventListener('abort', cancel, { once: true });
            if (signal?.aborted) { cancel(); return; }
            timer = setTimeout(() => finish(new Error('Local recognition took more than 20 minutes. Try a shorter edit or manual captions.')), timeoutMs);
            // A full owning buffer avoids transferring unrelated views or retaining a second decoded edit.
            const samples = audio.byteOffset === 0 && audio.byteLength === audio.buffer.byteLength ? audio : audio.slice();
            onProgress({ stage: 'model', fraction: null });
            worker.postMessage({ audio: samples.buffer, language }, [samples.buffer]);
        } catch (error) { finish(error); }
    });
}
export async function recognizeTimelineSpeech(timeline, blobs, options = {}) {
    const selection = speechSelection(timeline, options);
    const audio = await timelineSpeechPCM(timeline, blobs, { ...options, startFrame: selection.startFrame, endFrame: selection.endFrame });
    if (options.signal?.aborted) throw aborted();
    const cues = await recognizeSpeechPCM(audio, options);
    if (options.signal?.aborted) throw aborted();
    return cues.map(cue => ({ ...cue, start: cue.start + selection.startFrame }));
}
