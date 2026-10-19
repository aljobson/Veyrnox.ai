import { helperEnglish } from '../../../lib/helperMessages.mjs';
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
    if(error?.name==='NotAllowedError' || error?.name==='SecurityError')return helperEnglish('microphone_access_was_blocked_allow_it_in_your');
    if(error?.name==='NotFoundError')return helperEnglish('no_microphone_was_found_connect_one_and_retry');
    if(error?.name==='NotReadableError')return helperEnglish('the_microphone_is_busy_in_another_app_close');
    return helperEnglish('the_microphone_could_not_start_in_this_browser');
}
