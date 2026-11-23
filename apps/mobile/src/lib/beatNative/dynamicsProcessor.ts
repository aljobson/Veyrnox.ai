export type DynamicsSettings = {
    threshold?: number;
    knee?: number;
    ratio?: number;
    attack?: number;
    release?: number;
};

export type DynamicsProcessor = (input: Float32Array[], output: Float32Array[], inputChannels: number,
    outputChannels: number, frames: number, currentTime: number) => void;

const bounded = (value: number | undefined, fallback: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Number.isFinite(value) ? value! : fallback));

/**
 * A stereo-linked, look-ahead dynamics processor for react-native-audio-worklets.
 * State and delay storage are allocated once on the JS thread; the audio callback
 * performs no allocation and uses the same processor for live and offline graphs.
 */
export function createDynamicsProcessor(settings: DynamicsSettings = {}, contextRate = 48_000): DynamicsProcessor {
    const rate = bounded(contextRate, 48_000, 8_000, 192_000);
    const threshold = bounded(settings.threshold, -24, -100, 0);
    const knee = bounded(settings.knee, 30, 0, 40);
    const ratio = bounded(settings.ratio, 12, 1, 20);
    const attack = bounded(settings.attack, 0.003, 0, 1);
    const release = bounded(settings.release, 0.25, 0, 1);
    const attackCoefficient = attack === 0 ? 0 : Math.exp(-1 / (attack * rate));
    const releaseCoefficient = release === 0 ? 0 : Math.exp(-1 / (release * rate));
    const lookAheadFrames = Math.max(1, Math.round(rate * 0.006));
    const delayLeft = new Float32Array(lookAheadFrames);
    const delayRight = new Float32Array(lookAheadFrames);
    // Worklets rebuild scalar closure bindings from `this.__closure` on every quantum. Keep mutable
    // runtime state in one captured typed array instead; the cached worklet function owns its runtime copy.
    const runtimeState = new Float64Array(2); // cursor, envelope

    return (input, output, inputChannels, outputChannels, frames) => {
        'worklet';
        let cursor = runtimeState[0]!;
        let envelope = runtimeState[1]!;
        const activeInputs = Math.min(inputChannels, input.length);
        const activeOutputs = Math.min(outputChannels, output.length);
        for (let frame = 0; frame < frames; frame += 1) {
            const left = activeInputs > 0 ? input[0]![frame]! : 0;
            const right = activeInputs > 1 ? input[1]![frame]! : left;
            const peak = Math.max(Math.abs(left), Math.abs(right));
            const coefficient = peak > envelope ? attackCoefficient : releaseCoefficient;
            envelope = coefficient * envelope + (1 - coefficient) * peak;

            let gain = 1;
            if (envelope > 0) {
                const inputDb = 20 * Math.log10(envelope);
                let outputDb = inputDb;
                if (knee === 0) {
                    if (inputDb > threshold) outputDb = threshold + (inputDb - threshold) / ratio;
                } else {
                    const lower = threshold - knee / 2;
                    const upper = threshold + knee / 2;
                    if (inputDb > upper) outputDb = threshold + (inputDb - threshold) / ratio;
                    else if (inputDb >= lower) {
                        const x = inputDb - lower;
                        outputDb = inputDb + (1 / ratio - 1) * x * x / (2 * knee);
                    }
                }
                gain = 10 ** ((outputDb - inputDb) / 20);
            }

            const delayedLeft = delayLeft[cursor]!;
            const delayedRight = delayRight[cursor]!;
            delayLeft[cursor] = left;
            delayRight[cursor] = right;
            cursor = (cursor + 1) % lookAheadFrames;
            if (activeOutputs > 0) output[0]![frame] = delayedLeft * gain;
            if (activeOutputs > 1) output[1]![frame] = delayedRight * gain;
            for (let channel = 2; channel < activeOutputs; channel += 1) output[channel]![frame] = delayedRight * gain;
        }
        runtimeState[0] = cursor;
        runtimeState[1] = envelope;
    };
}
