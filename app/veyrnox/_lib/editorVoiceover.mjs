export const VOICEOVER_MIMES = Object.freeze(['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus']);

export function voiceoverMime(supported = type => globalThis.MediaRecorder?.isTypeSupported?.(type)) {
    return VOICEOVER_MIMES.find(type=>supported(type)) || '';
}

export function voiceoverExtension(mime) {
    if(mime.startsWith('audio/mp4'))return 'm4a';
    if(mime.startsWith('audio/ogg'))return 'ogg';
    return 'webm';
}

export function voiceoverProblem(error) {
    if(error?.name==='NotAllowedError' || error?.name==='SecurityError')return 'Microphone access was blocked. Allow it in your browser settings and retry.';
    if(error?.name==='NotFoundError')return 'No microphone was found. Connect one and retry.';
    if(error?.name==='NotReadableError')return 'The microphone is busy in another app. Close that app and retry.';
    return 'The microphone could not start in this browser.';
}
