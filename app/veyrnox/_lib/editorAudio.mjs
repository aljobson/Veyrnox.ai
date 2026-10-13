import { audioProcessingActive } from './editorAudioSettings.mjs';
import { audioEffectsProblem, audioEffectsWorkingBytes, connectAudioEffects, cutoffAudioEffects } from './editorAudioEffects.mjs';
import { audioClipInterval } from './editorAudioInterval.mjs';
import { processAudio } from './editorDsp.mjs';
import { audioRange, audioWorkingBytes } from './editorSpeed.mjs';
import { trackAudible } from './editorSelection.mjs';
import { sequenceTransitionAfter } from './editorSequence.mjs';
import { FPS, videoLayout, effectiveTransition } from './editorTimeline.mjs';
import { AudioBufferSink } from 'mediabunny';
export const SAMPLE_RATE = 48000;
const abortError = () => Object.assign(new Error('Playback cancelled.'), { name: 'AbortError' });

export async function mixAudio(tl, inputs, length, signal, { startFrame = 0, endFrame: requestedEndFrame, BufferSink = AudioBufferSink } = {}) {
    const endFrame = requestedEndFrame ?? startFrame + length / SAMPLE_RATE * FPS;
    if (!Number.isInteger(length) || length < 1 || !Number.isInteger(startFrame) || startFrame < 0 || (requestedEndFrame !== undefined && !Number.isInteger(endFrame)) || !Number.isFinite(endFrame) || endFrame <= startFrame || Math.abs((endFrame - startFrame) / FPS * SAMPLE_RATE - length) > 1) throw new Error('Choose a sample-aligned audio range.');
    const windowStart = startFrame / FPS, windowEnd = endFrame / FPS;
    const layers = [
        ...videoLayout(tl).map(({ clip, start }, k) => ({ clip, start, kind: 'video', fadeIn: clip.fadeIn || effectiveTransition(tl, k), fadeOut: clip.fadeOut || (tl.schemaVersion === 3 ? 0 : effectiveTransition(tl, k + 1)), transitionOut: tl.schemaVersion === 3 ? sequenceTransitionAfter(tl, clip) : effectiveTransition(tl, k + 1) })),
        ...tl.audio.map(clip => ({ clip, start: clip.start, kind: 'audio', fadeIn: clip.fadeIn || 0, fadeOut: clip.fadeOut || 0 })),
    ].map(layer => ({ ...layer, interval: audioClipInterval({ ...layer.clip, start: layer.start }, tl.media[layer.clip.mediaId], layer.transitionOut || 0) }));
    // Biquad state is established from the original start of every audible overlapping clip.
    // Finite echo needs only its last tap's history; nonlinear/time-stretch DSP retains its original context.
    const audible = layers.filter(({ clip, interval }) => interval.startFrame < endFrame && interval.endFrame > startFrame && tl.media[clip.mediaId]?.hasAudio && clip.volume > 0 && clip.freezeFrame === undefined && trackAudible(tl, clip));
    for (const { clip } of layers) { const problem = audioEffectsProblem(clip.audioEffects); if (problem) throw new Error(problem); }
    const effectsBytes = audible.reduce((sum, { clip }) => sum + audioEffectsWorkingBytes(clip.audioEffects, SAMPLE_RATE), 0);
    const relevant = audible.map(({ clip, start }) => ({ ...clip, start }));
    const earliest = Math.min(windowStart, ...relevant.map(clip => Object.values(clip.eq || {}).some(Boolean) || clip.audioProcessing?.voice === 'radio' ? clip.start / FPS : clip.audioEffects?.echoMix > 0 ? Math.max(clip.start / FPS, windowStart - clip.audioEffects.echoDelay * clip.audioEffects.echoRepeats - 1 / SAMPLE_RATE) : windowStart));
    const outputOffset = Math.ceil((windowStart - earliest) * SAMPLE_RATE), renderStart = windowStart - outputOffset / SAMPLE_RATE, renderLength = length + outputOffset;
    const working = { ...tl, video: audible.filter(layer => layer.kind === 'video').map(({ clip, start }) => ({ ...clip, start })), audio: audible.filter(layer => layer.kind === 'audio').map(({ clip }) => clip), text: [] };
    const workingEnd = Math.max(0, ...relevant.map(clip => clip.start + clip.len));
    const dryDecodeSavings = relevant.filter(clip => !clip.reverse && !clip.speedCurve?.length && !audioProcessingActive(clip)).reduce((sum, clip) => {
        const rate = clip.rate ?? 1, selectedSeconds = Math.max(0, Math.min(windowEnd, (clip.start + clip.len + 60) / FPS) - Math.max(renderStart, clip.start / FPS));
        return sum + Math.max(0, (clip.len + 60) / FPS * rate - selectedSeconds * rate) * SAMPLE_RATE * 2 * 4;
    }, 0);
    if(effectsBytes + audioWorkingBytes(working) - dryDecodeSavings - workingEnd / FPS * SAMPLE_RATE * 2 * 4 + renderLength * 2 * 4 + (outputOffset ? length * 2 * 4 : 0)>512*1024*1024)throw new Error('This audio mix exceeds the browser memory budget. Shorten the edit or use fewer sound tracks.');
    const ctx = new OfflineAudioContext(2, renderLength, SAMPLE_RATE);
    const memoryCap=512*1024*1024,contextBytes=effectsBytes + (renderLength + (outputOffset ? length : 0))*2*4;let retainedBytes=0,used = 0;
    for (const { clip, start, fadeIn, fadeOut, transitionOut = 0, interval } of audible) {
        if (signal.aborted) throw abortError();
        const media = tl.media[clip.mediaId];
        // Keep the outgoing source running beneath its next transition, even when clips were inserted out of array order.
        const rate = clip.rate ?? 1;
        const { extra, processed } = interval;
        const at = start / FPS, cut = at + clip.len / FPS, end = cut + extra / FPS;
        const from = clip.in / FPS + Math.max(0, renderStart - at) * rate, to = Math.min(clip.in + (clip.len + extra) * rate, media.frames, clip.in + Math.max(0, windowEnd - at) * FPS * rate) / FPS;
        const stop = Math.min(end, windowEnd) - renderStart;
        if (stop <= Math.max(0, at - renderStart) || (!processed && to <= from)) continue;
        const track = await inputs.get(clip.mediaId).getPrimaryAudioTrack();
        if (!track) continue;
        const gain = ctx.createGain(); gain.gain.value = clip.volume;
        let tail = connectAudioEffects(ctx, gain, clip.audioEffects, { clipStart: at, clipEnd: end, renderStart });
        const envelope = (begin, finish, entering) => {
            const fade = ctx.createGain(), fraction = Math.max(0, Math.min(1, (renderStart - begin) / Math.max(1 / SAMPLE_RATE, finish - begin)));
            fade.gain.setValueAtTime(entering ? fraction : 1 - fraction, 0);
            if (begin > renderStart) fade.gain.setValueAtTime(entering ? 0 : 1, begin - renderStart);
            if (finish > renderStart) fade.gain.linearRampToValueAtTime(entering ? 1 : 0, finish - renderStart);
            tail.connect(fade); tail = fade;
        };
        if (fadeIn > 0) envelope(at, at + fadeIn / FPS, true);
        if (fadeOut > 0) envelope(tl.schemaVersion === 3 ? Math.max(at, cut - fadeOut / FPS) : cut, tl.schemaVersion === 3 ? cut : cut + fadeOut / FPS, false);
        if (tl.schemaVersion === 3 && transitionOut > 0) envelope(cut, cut + transitionOut / FPS, false);
        if (clip.eq) for (const [type, frequency, value] of [['lowshelf', 200, clip.eq.low], ['peaking', 1000, clip.eq.mid], ['highshelf', 5000, clip.eq.high]]) {
            const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency; filter.gain.value = value; tail.connect(filter); tail = filter;
        }
        if(clip.audioProcessing?.voice==='radio')for(const [type,frequency] of [['highpass',300],['lowpass',3400]]){const filter=ctx.createBiquadFilter();filter.type=type;filter.frequency.value=frequency;tail.connect(filter);tail=filter;}
        if (clip.pan) { const pan = ctx.createStereoPanner(); pan.pan.value = clip.pan; tail.connect(pan); tail = pan; }
        tail = cutoffAudioEffects(ctx, tail, clip.audioEffects, end - renderStart);
        tail.connect(ctx.destination);
        if(processed) {
            const bounds=audioRange(clip,extra),chunks=[];let decodedBytes=0;const outputBytes=Math.max(1,Math.ceil((end-at)*SAMPLE_RATE))*2*4;
            for await(const wrapped of new BufferSink(track).buffers(Math.max(0,bounds.from)/FPS,Math.min(media.frames,bounds.to+1)/FPS)) {
                if(signal.aborted)throw abortError();
                decodedBytes+=wrapped.buffer.length*wrapped.buffer.numberOfChannels*4;
                if(contextBytes+retainedBytes+outputBytes*3+decodedBytes*(clip.audioProcessing?.noiseReduction?5:1)>memoryCap)throw new Error('Decoded audio exceeds the browser memory budget. Shorten the edit or use fewer sound tracks.');
                chunks.push({timestamp:wrapped.timestamp,sampleRate:wrapped.buffer.sampleRate,channels:Array.from({length:Math.min(2,wrapped.buffer.numberOfChannels)},(_,ch)=>wrapped.buffer.getChannelData(ch))});
            }
            const count=Math.max(1,Math.ceil((end-at)*SAMPLE_RATE)),mapped=await processAudio(chunks,clip,count,SAMPLE_RATE,signal),buffer=ctx.createBuffer(2,count,SAMPLE_RATE);
            for(let ch=0;ch<2;ch++)buffer.copyToChannel(mapped[ch],ch);
            retainedBytes+=buffer.length*2*4;const node=ctx.createBufferSource();node.buffer=buffer;node.connect(gain);node.start(Math.max(0, at - renderStart), Math.max(0, renderStart - at));node.stop(stop);used++;continue;
        }
        for await (const wrapped of new BufferSink(track).buffers(from, to)) {
            if (signal.aborted) throw abortError();
            retainedBytes+=wrapped.buffer.length*wrapped.buffer.numberOfChannels*4;
            if(contextBytes+retainedBytes>memoryCap)throw new Error('Decoded audio exceeds the browser memory budget. Shorten the edit or use fewer sound tracks.');
            let when = at + (wrapped.timestamp - clip.in / FPS) / rate - renderStart, offset = 0;
            const first = Math.max(0, at - renderStart);
            if (when < first) { offset = (first - when) * rate; when = first; }
            if (when >= stop || offset >= wrapped.buffer.duration || !wrapped.buffer.length) continue;
            const node = ctx.createBufferSource();
            node.buffer = wrapped.buffer;
            node.playbackRate.value = rate;
            node.connect(gain);
            node.start(when, offset);
            node.stop(stop);
        }
        used += 1;
    }
    if (signal.aborted) throw abortError();
    if (!used) return null;
    let mix = await ctx.startRendering();
    if (outputOffset) {
        const selected = ctx.createBuffer(2, length, SAMPLE_RATE);
        for (let ch = 0; ch < 2; ch++) selected.copyToChannel(mix.getChannelData(ch).subarray(outputOffset, outputOffset + length), ch);
        mix = selected;
    }
    // Overlapping tracks and EQ can exceed full scale. A shared peak normalizer preserves their balance without hard clipping.
    // For bounded recognition windows the peak belongs to that selected range, not unseen audio.
    if (tl.schemaVersion === 3) {
        let peak = 1;
        for (let ch = 0; ch < mix.numberOfChannels; ch++) for (const sample of mix.getChannelData(ch)) peak = Math.max(peak, Math.abs(sample));
        if (peak > 1) for (let ch = 0; ch < mix.numberOfChannels; ch++) { const samples = mix.getChannelData(ch); for (let n = 0; n < samples.length; n++) samples[n] /= peak; }
    }
    return mix;
}
