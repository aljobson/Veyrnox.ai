export interface SpeechGate { check(uri: string): Promise<'speech' | 'none' | 'unknown'> }
// Unknown means upload with consent, then settle on the server. No native module is installed.
const serverGate: SpeechGate = { check: async () => 'unknown' };
export function bestCutSpeechGate(native?: SpeechGate): SpeechGate {
    return process.env.EXPO_PUBLIC_BEST_CUT_DEVICE_SPEECH_ENABLED === 'true' && native ? native : serverGate;
}
