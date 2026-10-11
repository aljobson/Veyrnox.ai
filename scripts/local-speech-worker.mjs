import { pipeline, env } from './transformers.min.js';
// The generated manifest is pinned into this source during preparation.
const MANIFEST_SHA256 = '__MANIFEST_SHA256__';
const base = new URL('./', self.location.href), modelBase = new URL('./models/', base);
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
let manifest;
// Install the message listener without a top-level await: queued PCM cannot be lost during initialization.
const manifestReady = fetch(new URL('manifest.json', base), { credentials: 'omit', redirect: 'error' }).then(async response => {
    if (!response.ok) throw new Error('The local speech model is unavailable.');
    const bytes = await response.arrayBuffer();
    if (await digest(bytes) !== MANIFEST_SHA256) throw new Error('The local speech manifest failed its integrity check.');
    manifest = JSON.parse(new TextDecoder().decode(bytes));
});
async function verified(spec) {
    const response = await fetch(new URL(spec.path, base), { credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error('The local speech asset is unavailable.');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== spec.bytes || await digest(bytes) !== spec.sha256) throw new Error('The local speech asset failed its integrity check.');
    return new Uint8Array(bytes);
}
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = modelBase.href;
env.useBrowserCache = false;
env.useFS = false;
env.useFSCache = false;
env.backends.onnx.wasm.wasmPaths = base.href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.useCustomCache = true;
env.customCache = { put() {}, async match(request) {
    const url = new URL(request, base), path = url.origin === base.origin && url.pathname.startsWith(base.pathname) ? url.pathname.slice(base.pathname.length) : '';
    const spec = manifest.models[path];
    if (!spec || url.search || url.hash) return new Response('', { status: 404 });
    try {
        let bytes;
        if (spec.chunks) {
            const parts = [];
            for (const part of spec.chunks) parts.push(await verified(part));
            bytes = new Uint8Array(spec.bytes); let offset = 0;
            for (const part of parts) { bytes.set(part, offset); offset += part.length; }
            if (offset !== spec.bytes || await digest(bytes) !== spec.sha256) throw new Error('The reassembled local model failed its integrity check.');
        } else bytes = await verified(spec);
        return new Response(bytes, { headers: { 'Content-Length': String(spec.bytes), 'Content-Type': 'application/octet-stream' } });
    } catch { return new Response('', { status: 500 }); }
} };
let busy = false;
self.onmessage = async event => {
    if (busy) return;
    busy = true;
    let transcriber;
    try {
        const audio = event.data?.audio, language = event.data?.language;
        if (!(audio instanceof ArrayBuffer) || audio.byteLength < 4 || audio.byteLength > 120 * 16000 * 4 || audio.byteLength % 4 || !['english','spanish','french','german','italian','portuguese','japanese','korean','chinese','hindi','arabic'].includes(language)) throw new Error('Choose a supported language and audio up to two minutes.');
        const samples = new Float32Array(audio);
        if (samples.some(n => !Number.isFinite(n) || Math.abs(n) > 1)) throw new Error('The decoded sound has invalid samples.');
        postMessage({ stage: 'model' });
        await manifestReady;
        transcriber = await pipeline('automatic-speech-recognition', manifest.model, { dtype: 'q8', device: 'wasm', local_files_only: true, progress_callback: progress => postMessage({ stage: 'model', fraction: Number.isFinite(progress.progress) ? Math.min(1, Math.max(0, progress.progress / 100)) : null }) });
        postMessage({ stage: 'recognition' });
        const result = await transcriber(samples, { language, task: 'transcribe', return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
        postMessage({ stage: 'result', result });
    } catch (error) { postMessage({ stage: 'error', message: String(error.message || 'Local recognition failed.') }); }
    finally { if (transcriber) await transcriber.dispose(); busy = false; }
};
