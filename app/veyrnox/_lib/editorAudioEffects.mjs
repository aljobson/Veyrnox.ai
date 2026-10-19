import { helperEnglish } from '../../../lib/helperMessages.mjs';
/** Original local effects; absent settings retain the existing sound exactly. */
export const AUDIO_EFFECT_DEFAULTS = Object.freeze({ width: 1, tremoloRate: 4, tremoloDepth: 0, echoDelay: .2, echoDecay: .45, echoRepeats: 3, echoMix: 0 });
export const MAX_ECHO_TAIL_SECONDS = 4;
export function audioEffectsProblem(settings) {
    if (settings === undefined) return null;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).length !== Object.keys(AUDIO_EFFECT_DEFAULTS).length || Object.keys(settings).some(key => !Object.hasOwn(AUDIO_EFFECT_DEFAULTS, key))) return helperEnglish('invalid_audio_effects_settings');
    for (const [key, min, max] of [['width', 0, 2], ['tremoloRate', .1, 20], ['tremoloDepth', 0, 1], ['echoDelay', .01, 1], ['echoDecay', .05, .9], ['echoRepeats', 1, 8], ['echoMix', 0, 1]]) {
        if (!Number.isFinite(settings[key]) || settings[key] < min || settings[key] > max) return helperEnglish('audio_effects_are_outside_their_supported_range');
    }
    if (!Number.isInteger(settings.echoRepeats) || settings.echoDelay * settings.echoRepeats > MAX_ECHO_TAIL_SECONDS) return helperEnglish('echo_needs_whole_repeats_with_a_combined_delay');
    return null;
}
export const audioEffectsActive = settings => !!settings && (settings.width !== 1 || settings.tremoloDepth > 0 || settings.echoMix > 0);
/** Delay nodes allocate their maximum delay per channel. Reserve four channels plus graph overhead. */
export function audioEffectsWorkingBytes(settings, sampleRate = 48000) {
    if (!audioEffectsActive(settings)) return 0;
    const delaySamples = settings.echoMix ? Array.from({ length: settings.echoRepeats }, (_, i) => Math.ceil(settings.echoDelay * (i + 1) * sampleRate) + 1).reduce((sum, n) => sum + n, 0) : 0;
    return delaySamples * 4 * 4 + 32768;
}

/** Connect finite Web Audio effects before the existing fade/EQ/pan chain. Echo never extends the clip. */
export function connectAudioEffects(context, input, settings, { clipStart, clipEnd, renderStart }) {
    const problem = audioEffectsProblem(settings); if (problem) throw new Error(problem);
    if (!audioEffectsActive(settings)) return input;
    let tail = input;
    if (settings.width !== 1) {
        // Explicit speaker upmix preserves mono sources before the mid/side matrix splits channels.
        const stereo = context.createGain(); stereo.channelCount = 2; stereo.channelCountMode = 'explicit'; stereo.channelInterpretation = 'speakers'; tail.connect(stereo);
        const splitter = context.createChannelSplitter(2), merger = context.createChannelMerger(2); stereo.connect(splitter);
        for (let source = 0; source < 2; source++) for (let channel = 0; channel < 2; channel++) {
            const coefficient = context.createGain(); coefficient.gain.value = (1 + (source === channel ? settings.width : -settings.width)) / 2;
            splitter.connect(coefficient, source); coefficient.connect(merger, 0, channel);
        }
        tail = merger;
    }
    if (settings.tremoloDepth) {
        const tremolo = context.createGain(), oscillator = context.createOscillator(), depth = context.createGain();
        tremolo.gain.value = 1 - settings.tremoloDepth / 2; depth.gain.value = settings.tremoloDepth / 2; oscillator.frequency.value = settings.tremoloRate;
        // Start the selected range at the original clip's phase, without a new tremolo attack.
        const phase = 2 * Math.PI * settings.tremoloRate * Math.max(0, renderStart - clipStart);
        oscillator.setPeriodicWave(context.createPeriodicWave(new Float32Array([0, Math.sin(phase)]), new Float32Array([0, Math.cos(phase)]), { disableNormalization: true }));
        oscillator.connect(depth); depth.connect(tremolo.gain); tail.connect(tremolo); tail = tremolo;
        oscillator.start(Math.max(0, clipStart - renderStart)); oscillator.stop(Math.min(clipEnd - renderStart, context.length / context.sampleRate));
    }
    if (settings.echoMix) {
        const sum = context.createGain(), dry = context.createGain(); dry.gain.value = 1 - settings.echoMix; tail.connect(dry); dry.connect(sum);
        const weights = Array.from({ length: settings.echoRepeats }, (_, i) => settings.echoDecay ** (i + 1)), total = weights.reduce((a, b) => a + b, 0);
        weights.forEach((weight, i) => {
            const seconds = settings.echoDelay * (i + 1), delay = context.createDelay(seconds + 1 / context.sampleRate), wet = context.createGain();
            delay.delayTime.value = seconds; wet.gain.value = settings.echoMix * weight / total; tail.connect(delay); delay.connect(wet); wet.connect(sum);
        });
        tail = sum;
    }
    return tail;
}

/** Bound the final output, after fades and stateful EQ, so delayed sound cannot extend an edit. */
export function cutoffAudioEffects(context, input, settings, endTime) {
    if (!audioEffectsActive(settings)) return input;
    const cutoff = context.createGain(); cutoff.gain.setValueAtTime(1, 0); cutoff.gain.setValueAtTime(0, Math.max(0, endTime)); input.connect(cutoff);
    return cutoff;
}
