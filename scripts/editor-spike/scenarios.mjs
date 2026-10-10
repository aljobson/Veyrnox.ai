// The timelines slice 0 renders. `start` is where a clip sits on the timeline, [in, out) is the source range, fadeIn/fadeOut a crossfade.
export const S1 = {
    name: 's1-720p-mixed', width: 1280, height: 720, fps: 30, duration: 9.5,
    clips: [
        { src: 'a.mp4', start: 0, in: 0, out: 4, fadeOut: 0.5 },               // blue, 440 Hz
        { src: 'b.mp4', start: 3.5, in: 0, out: 4, fadeIn: 0.5 },              // red, 880 Hz, crossfades over a
        { src: 'c.mp4', start: 7.5, in: 0, out: 2 },                           // green PORTRAIT, 330 Hz, letterboxed
    ],
    audio: [{ src: 'music.wav', start: 0, in: 0, out: 9.5, gain: 0.3 }],       // 220 Hz bed
    texts: [{ text: 'Veyrnox slice 0', from: 4, to: 6, x: 0.5, y: 0.85, size: 64 }],
};

export const S2 = (() => {
    const clips = [];
    for (let k = 0; k < 10; k++) {
        clips.push({
            src: k % 2 ? 'h2.mp4' : 'h1.mp4', start: k * 5.5, in: 0, out: 6,
            ...(k > 0 ? { fadeIn: 0.5 } : {}), ...(k < 9 ? { fadeOut: 0.5 } : {}),
        });
    }
    return {
        name: 's2-1080p-10clips', width: 1920, height: 1080, fps: 30, duration: 55.5, clips,
        texts: [0, 20, 40].map(from => ({ text: 'Veyrnox slice 0', from, to: from + 3, x: 0.5, y: 0.88, size: 96 })),
    };
})();

// A clip with no audio track in the middle of clips that have one.
export const S5 = {
    name: 's5-missing-audio', width: 1280, height: 720, fps: 30, duration: 3,
    clips: [{ src: 'a.mp4', start: 0, in: 0, out: 1.5 }, { src: 'noaudio.mp4', start: 1.5, in: 0, out: 1.5 }],
};

export const COMPAT = ['a.mp4', 'h264.mov', 'vp9.webm', 'hevc.mp4', 'opus.mp4', 'noaudio.mp4', 'music.wav'];
