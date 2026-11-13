const ascii = (bytes, offset, value) => [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));

function writeAscii(view, offset, value) {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function refusal(error) {
    return { ok: false, error };
}

function parsePcmWav(source) {
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source || 0);
    if (bytes.length < 44 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WAVE')) return refusal('wav_invalid');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let fmt = null;
    let data = null;
    for (let offset = 12; offset + 8 <= bytes.length;) {
        const size = view.getUint32(offset + 4, true);
        const body = offset + 8;
        const next = body + size + (size & 1);
        if (body + size > bytes.length || next > bytes.length + 1) return refusal('wav_invalid');
        if (ascii(bytes, offset, 'fmt ')) {
            if (fmt) return refusal('wav_invalid');
            fmt = { body, size };
        } else if (ascii(bytes, offset, 'data')) {
            if (data) return refusal('wav_invalid');
            data = { body, size };
        }
        offset = next;
    }
    if (!fmt || !data || fmt.size < 16 || data.size < 1) return refusal('wav_invalid');

    const format = view.getUint16(fmt.body, true);
    const channels = view.getUint16(fmt.body + 2, true);
    const sampleRate = view.getUint32(fmt.body + 4, true);
    const byteRate = view.getUint32(fmt.body + 8, true);
    const blockAlign = view.getUint16(fmt.body + 12, true);
    const bitsPerSample = view.getUint16(fmt.body + 14, true);
    const sampleBytes = bitsPerSample / 8;
    if (format !== 1 || !Number.isInteger(sampleBytes) || sampleBytes < 1 || sampleBytes > 4
        || channels < 1 || channels > 8 || sampleRate < 1 || sampleRate > 384000
        || blockAlign !== channels * sampleBytes || byteRate !== sampleRate * blockAlign
        || data.size % blockAlign !== 0) {
        return refusal('wav_format_unsupported');
    }
    return {
        ok: true, bytes, view, fmt, data, channels, sampleRate, blockAlign, bitsPerSample, sampleBytes,
        totalFrames: data.size / blockAlign,
    };
}

function buildPcmWav(parsed, frameBytes) {
    const fmtPadding = parsed.fmt.size & 1;
    const dataPadding = frameBytes.length & 1;
    const output = new Uint8Array(12 + 8 + parsed.fmt.size + fmtPadding + 8 + frameBytes.length + dataPadding);
    const outputView = new DataView(output.buffer);
    writeAscii(outputView, 0, 'RIFF');
    outputView.setUint32(4, output.length - 8, true);
    writeAscii(outputView, 8, 'WAVE');
    writeAscii(outputView, 12, 'fmt ');
    outputView.setUint32(16, parsed.fmt.size, true);
    output.set(parsed.bytes.subarray(parsed.fmt.body, parsed.fmt.body + parsed.fmt.size), 20);
    const dataHeader = 20 + parsed.fmt.size + fmtPadding;
    writeAscii(outputView, dataHeader, 'data');
    outputView.setUint32(dataHeader + 4, frameBytes.length, true);
    output.set(frameBytes, dataHeader + 8);
    return output;
}

function readSample(view, offset, bits) {
    if (bits === 8) return view.getUint8(offset) - 128;
    if (bits === 16) return view.getInt16(offset, true);
    if (bits === 24) {
        const value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
        return value & 0x800000 ? value - 0x1000000 : value;
    }
    return view.getInt32(offset, true);
}

function writeSample(view, offset, bits, value) {
    const maximum = bits === 8 ? 127 : (2 ** (bits - 1)) - 1;
    const minimum = bits === 8 ? -128 : -(2 ** (bits - 1));
    const sample = Math.max(minimum, Math.min(maximum, Math.round(value)));
    if (bits === 8) view.setUint8(offset, sample + 128);
    else if (bits === 16) view.setInt16(offset, sample, true);
    else if (bits === 24) {
        const unsigned = sample < 0 ? sample + 0x1000000 : sample;
        view.setUint8(offset, unsigned & 0xff);
        view.setUint8(offset + 1, (unsigned >> 8) & 0xff);
        view.setUint8(offset + 2, (unsigned >> 16) & 0xff);
    } else view.setInt32(offset, sample, true);
}

/**
 * Render one PCM WAV time range into a standalone canonical WAV.
 *
 * This deliberately accepts only fixed-frame PCM. Cropping compressed or
 * floating-point WAV without a decoder would make the resulting master
 * dependent on container quirks, so those formats stay preview-only.
 */
export function renderPcmWavCrop(source, startSeconds, endSeconds) {
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds) {
        return refusal('crop_range_invalid');
    }
    const parsed = parsePcmWav(source);
    if (!parsed.ok) return parsed;
    const startFrame = Math.floor(startSeconds * parsed.sampleRate);
    const endFrame = Math.min(parsed.totalFrames, Math.ceil(endSeconds * parsed.sampleRate));
    if (startFrame < 0 || startFrame >= parsed.totalFrames || endFrame <= startFrame || endSeconds > parsed.totalFrames / parsed.sampleRate + 0.000001) {
        return refusal('crop_range_invalid');
    }
    const sourceStart = parsed.data.body + startFrame * parsed.blockAlign;
    const frames = Uint8Array.from(parsed.bytes.subarray(sourceStart, parsed.data.body + endFrame * parsed.blockAlign));
    const output = buildPcmWav(parsed, frames);
    return {
        ok: true,
        bytes: output,
        seconds: (endFrame - startFrame) / parsed.sampleRate,
        sampleRate: parsed.sampleRate,
        channels: parsed.channels,
        bitsPerSample: parsed.bitsPerSample,
    };
}

/** Render linear fade envelopes into a new full-length PCM WAV master. */
export function renderPcmWavFade(source, fadeInSeconds, fadeOutSeconds) {
    const parsed = parsePcmWav(source);
    if (!parsed.ok) return parsed;
    const duration = parsed.totalFrames / parsed.sampleRate;
    if (!Number.isFinite(fadeInSeconds) || !Number.isFinite(fadeOutSeconds)
        || fadeInSeconds < 0 || fadeOutSeconds < 0 || fadeInSeconds + fadeOutSeconds > duration
        || fadeInSeconds > 30 || fadeOutSeconds > 30 || fadeInSeconds + fadeOutSeconds <= 0) {
        return refusal('fade_range_invalid');
    }
    const frames = Uint8Array.from(parsed.bytes.subarray(parsed.data.body, parsed.data.body + parsed.data.size));
    const frameView = new DataView(frames.buffer, frames.byteOffset, frames.byteLength);
    const fadeInFrames = Math.round(fadeInSeconds * parsed.sampleRate);
    const fadeOutFrames = Math.round(fadeOutSeconds * parsed.sampleRate);
    for (let frame = 0; frame < parsed.totalFrames; frame += 1) {
        const inGain = fadeInFrames > 0 && frame < fadeInFrames ? frame / fadeInFrames : 1;
        const remaining = parsed.totalFrames - 1 - frame;
        const outGain = fadeOutFrames > 0 && remaining < fadeOutFrames ? remaining / fadeOutFrames : 1;
        const gain = Math.min(inGain, outGain);
        if (gain === 1) continue;
        for (let channel = 0; channel < parsed.channels; channel += 1) {
            const offset = frame * parsed.blockAlign + channel * parsed.sampleBytes;
            writeSample(frameView, offset, parsed.bitsPerSample, readSample(frameView, offset, parsed.bitsPerSample) * gain);
        }
    }
    return {
        ok: true, bytes: buildPcmWav(parsed, frames), seconds: duration,
        sampleRate: parsed.sampleRate, channels: parsed.channels, bitsPerSample: parsed.bitsPerSample,
    };
}

/**
 * Render a speed-and-pitch-linked PCM WAV master using linear interpolation.
 * Keeping sample rate constant makes the duration change explicit and leaves
 * the original recoverable as the parent version.
 */
export function renderPcmWavSpeed(source, speedRatio) {
    const parsed = parsePcmWav(source);
    if (!parsed.ok) return parsed;
    if (!Number.isFinite(speedRatio) || speedRatio < 0.5 || speedRatio > 2
        || Math.abs(speedRatio - 1) < 0.000001) return refusal('speed_ratio_invalid');
    const outputFrames = Math.max(1, Math.round(parsed.totalFrames / speedRatio));
    const frames = new Uint8Array(outputFrames * parsed.blockAlign);
    const frameView = new DataView(frames.buffer);
    for (let frame = 0; frame < outputFrames; frame += 1) {
        const sourcePosition = Math.min(parsed.totalFrames - 1, frame * speedRatio);
        const left = Math.floor(sourcePosition);
        const right = Math.min(parsed.totalFrames - 1, left + 1);
        const mix = sourcePosition - left;
        for (let channel = 0; channel < parsed.channels; channel += 1) {
            const sourceOffset = parsed.data.body + left * parsed.blockAlign + channel * parsed.sampleBytes;
            const rightOffset = parsed.data.body + right * parsed.blockAlign + channel * parsed.sampleBytes;
            const outputOffset = frame * parsed.blockAlign + channel * parsed.sampleBytes;
            const sample = readSample(parsed.view, sourceOffset, parsed.bitsPerSample) * (1 - mix)
                + readSample(parsed.view, rightOffset, parsed.bitsPerSample) * mix;
            writeSample(frameView, outputOffset, parsed.bitsPerSample, sample);
        }
    }
    return {
        ok: true, bytes: buildPcmWav(parsed, frames), seconds: outputFrames / parsed.sampleRate,
        sampleRate: parsed.sampleRate, channels: parsed.channels, bitsPerSample: parsed.bitsPerSample,
    };
}

/** Split one PCM WAV at an exact time and move the second section first. */
export function renderPcmWavReorder(source, splitSeconds, order = [2, 1]) {
    const parsed = parsePcmWav(source);
    if (!parsed.ok) return parsed;
    const duration = parsed.totalFrames / parsed.sampleRate;
    if (!Number.isFinite(splitSeconds) || splitSeconds < 1 || splitSeconds > duration - 1
        || !Array.isArray(order) || order.length !== 2 || order[0] !== 2 || order[1] !== 1) {
        return refusal('reorder_range_invalid');
    }
    const splitFrame = Math.round(splitSeconds * parsed.sampleRate);
    if (splitFrame < 1 || splitFrame >= parsed.totalFrames) return refusal('reorder_range_invalid');
    const splitByte = parsed.data.body + splitFrame * parsed.blockAlign;
    const first = parsed.bytes.subarray(parsed.data.body, splitByte);
    const second = parsed.bytes.subarray(splitByte, parsed.data.body + parsed.data.size);
    const frames = new Uint8Array(parsed.data.size);
    frames.set(second, 0);
    frames.set(first, second.length);
    return {
        ok: true, bytes: buildPcmWav(parsed, frames), seconds: duration,
        sampleRate: parsed.sampleRate, channels: parsed.channels, bitsPerSample: parsed.bitsPerSample,
    };
}

/**
 * Produce a conservative PCM WAV remaster without inventing spectral detail.
 * Each channel's DC bias is removed, then one linked gain places the loudest
 * corrected sample at the selected peak ceiling. Linked gain preserves the
 * stereo image and the bounded ceiling prevents clipping.
 */
export function renderPcmWavRemaster(source, targetPeakDbfs) {
    const parsed = parsePcmWav(source);
    if (!parsed.ok) return parsed;
    if (![-3, -2, -1].includes(targetPeakDbfs)) return refusal('remaster_target_invalid');

    const sums = Array.from({ length: parsed.channels }, () => 0);
    for (let frame = 0; frame < parsed.totalFrames; frame += 1) {
        for (let channel = 0; channel < parsed.channels; channel += 1) {
            const offset = parsed.data.body + frame * parsed.blockAlign + channel * parsed.sampleBytes;
            sums[channel] += readSample(parsed.view, offset, parsed.bitsPerSample);
        }
    }
    const offsets = sums.map((sum) => sum / parsed.totalFrames);
    let correctedPeak = 0;
    for (let frame = 0; frame < parsed.totalFrames; frame += 1) {
        for (let channel = 0; channel < parsed.channels; channel += 1) {
            const offset = parsed.data.body + frame * parsed.blockAlign + channel * parsed.sampleBytes;
            correctedPeak = Math.max(correctedPeak, Math.abs(readSample(parsed.view, offset, parsed.bitsPerSample) - offsets[channel]));
        }
    }
    if (correctedPeak < 1) return refusal('remaster_silence');

    const maximum = (2 ** (parsed.bitsPerSample - 1)) - 1;
    const targetPeak = maximum * (10 ** (targetPeakDbfs / 20));
    const gain = targetPeak / correctedPeak;
    const frames = new Uint8Array(parsed.data.size);
    const frameView = new DataView(frames.buffer);
    for (let frame = 0; frame < parsed.totalFrames; frame += 1) {
        for (let channel = 0; channel < parsed.channels; channel += 1) {
            const sourceOffset = parsed.data.body + frame * parsed.blockAlign + channel * parsed.sampleBytes;
            const outputOffset = frame * parsed.blockAlign + channel * parsed.sampleBytes;
            writeSample(frameView, outputOffset, parsed.bitsPerSample,
                (readSample(parsed.view, sourceOffset, parsed.bitsPerSample) - offsets[channel]) * gain);
        }
    }
    return {
        ok: true, bytes: buildPcmWav(parsed, frames), seconds: parsed.totalFrames / parsed.sampleRate,
        sampleRate: parsed.sampleRate, channels: parsed.channels, bitsPerSample: parsed.bitsPerSample,
        targetPeakDbfs, inputPeakDbfs: 20 * Math.log10(correctedPeak / maximum),
        gainDb: 20 * Math.log10(gain), dcOffsets: offsets,
    };
}
