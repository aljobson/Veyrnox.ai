export const LOCAL_SPEECH_ASSET_PATH = '/editor-speech/whisper-tiny-51724429-transformers-3.8.1';
export const LOCAL_SPEECH_WORKER_URL = `${LOCAL_SPEECH_ASSET_PATH}/worker.mjs`;
// This policy applies only to the exact static module Worker response. HTML keeps its nonce policy.
export function localSpeechWorkerPolicy(publicOrigin) {
    const origin = new URL(publicOrigin).origin, path = `${origin}${LOCAL_SPEECH_ASSET_PATH}/`;
    return `default-src 'none'; script-src ${path} 'wasm-unsafe-eval'; connect-src ${path}; worker-src 'none'; base-uri 'none'; object-src 'none'`;
}
