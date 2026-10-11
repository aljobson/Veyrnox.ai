import { audioProcessingActive } from './editorAudioSettings.mjs';
import { processAudio } from './editorDsp.mjs';
import { audioRange, audioWorkingBytes } from './editorSpeed.mjs';
import { trackAudible } from './editorSelection.mjs';
import { sequenceTransitionAfter } from './editorSequence.mjs';
import { FPS, videoLayout, effectiveTransition } from './editorTimeline.mjs';
import { AudioBufferSink } from 'mediabunny';
export const SAMPLE_RATE = 48000;
const abortError = () => Object.assign(new Error('Playback cancelled.'), { name: 'AbortError' });

export async function mixAudio(tl, inputs, length, signal) {
    if(audioWorkingBytes(tl)>512*1024*1024)throw new Error('This audio mix exceeds the browser memory budget. Shorten the edit or use fewer sound tracks.');
    const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);
    const layers = [
        ...videoLayout(tl).map(({ clip, start }, k) => ({ clip, start, fadeIn: clip.fadeIn || effectiveTransition(tl, k), fadeOut: clip.fadeOut || (tl.schemaVersion === 3 ? 0 : effectiveTransition(tl, k + 1)), transitionOut: tl.schemaVersion === 3 ? sequenceTransitionAfter(tl, clip) : effectiveTransition(tl, k + 1) })),
        ...tl.audio.map(clip => ({ clip, start: clip.start, fadeIn: clip.fadeIn || 0, fadeOut: clip.fadeOut || 0 })),
    ];
    const memoryCap=512*1024*1024,contextBytes=length*2*4;let retainedBytes=0,used = 0;
    for (const { clip, start, fadeIn, fadeOut, transitionOut = 0 } of layers) {
        if (signal.aborted) throw abortError();
        const media = tl.media[clip.mediaId];
        if (clip.freezeFrame!==undefined || !media.hasAudio || clip.volume === 0 || !trackAudible(tl, clip)) continue;
        const track = await inputs.get(clip.mediaId).getPrimaryAudioTrack();
        if (!track) continue;
        // Keep the outgoing source running beneath its next transition, even when clips were inserted out of array order.
        const rate = clip.rate ?? 1;
        const extra = clip.reverse || clip.speedCurve?.length || audioProcessingActive(clip) ? transitionOut : Math.max(0, Math.min(transitionOut, (media.frames - (clip.in + clip.len * rate)) / rate));
        const from = clip.in / FPS, to = Math.min(clip.in + (clip.len + extra) * rate, media.frames) / FPS;
        const at = start / FPS, cut = at + clip.len / FPS, end = cut + extra / FPS;
        const gain = ctx.createGain(); gain.gain.value = clip.volume;
        let tail = gain;
        const envelope = (begin, finish, entering) => {
            const fade = ctx.createGain(); fade.gain.setValueAtTime(entering ? 0 : 1, Math.max(0, begin));
            fade.gain.linearRampToValueAtTime(entering ? 1 : 0, Math.max(begin, finish));
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
        tail.connect(ctx.destination);
        if(clip.reverse || clip.speedCurve?.length || audioProcessingActive(clip)) {
            const bounds=audioRange(clip,extra),chunks=[];let decodedBytes=0;const outputBytes=Math.max(1,Math.ceil((end-at)*SAMPLE_RATE))*2*4;
            for await(const wrapped of new AudioBufferSink(track).buffers(Math.max(0,bounds.from)/FPS,Math.min(media.frames,bounds.to+1)/FPS)) {
                if(signal.aborted)throw abortError();
                decodedBytes+=wrapped.buffer.length*wrapped.buffer.numberOfChannels*4;
                if(contextBytes+retainedBytes+outputBytes*3+decodedBytes*(clip.audioProcessing?.noiseReduction?5:1)>memoryCap)throw new Error('Decoded audio exceeds the browser memory budget. Shorten the edit or use fewer sound tracks.');
                chunks.push({timestamp:wrapped.timestamp,sampleRate:wrapped.buffer.sampleRate,channels:Array.from({length:Math.min(2,wrapped.buffer.numberOfChannels)},(_,ch)=>wrapped.buffer.getChannelData(ch))});
            }
            const count=Math.max(1,Math.ceil((end-at)*SAMPLE_RATE)),mapped=await processAudio(chunks,clip,count,SAMPLE_RATE,signal),buffer=ctx.createBuffer(2,count,SAMPLE_RATE);
            for(let ch=0;ch<2;ch++)buffer.copyToChannel(mapped[ch],ch);
            retainedBytes+=buffer.length*2*4;const node=ctx.createBufferSource();node.buffer=buffer;node.connect(gain);node.start(at);node.stop(end);used++;continue;
        }
        for await (const wrapped of new AudioBufferSink(track).buffers(from, to)) {
            if (signal.aborted) throw abortError();
            retainedBytes+=wrapped.buffer.length*wrapped.buffer.numberOfChannels*4;
            if(contextBytes+retainedBytes>memoryCap)throw new Error('Decoded audio exceeds the browser memory budget. Shorten the edit or use fewer sound tracks.');
            const node = ctx.createBufferSource();
            node.buffer = wrapped.buffer;
            node.playbackRate.value = rate;
            node.connect(gain);
            let when = at + (wrapped.timestamp - from) / rate, offset = 0;
            if (when < at) { offset = (at - when) * rate; when = at; }
            node.start(when, offset);
            node.stop(end);
        }
        used += 1;
    }
    if (signal.aborted) throw abortError();
    if (!used) return null;
    const mix = await ctx.startRendering();
    // Overlapping tracks and EQ can exceed full scale. A shared peak normalizer preserves their balance without hard clipping.
    if (tl.schemaVersion === 3) {
        let peak = 1;
        for (let ch = 0; ch < mix.numberOfChannels; ch++) for (const sample of mix.getChannelData(ch)) peak = Math.max(peak, Math.abs(sample));
        if (peak > 1) for (let ch = 0; ch < mix.numberOfChannels; ch++) { const samples = mix.getChannelData(ch); for (let n = 0; n < samples.length; n++) samples[n] /= peak; }
    }
    return mix;
}
