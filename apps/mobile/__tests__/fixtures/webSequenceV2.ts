export const webSequenceV2 = () => ({
    schemaVersion: 2, fps: 30, seq: 6, aspect: '16:9',
    media: { m: { id: 'm', kind: 'video', name: 'Source', frames: 900, hasAudio: true, width: 640, height: 360 } },
    video: [90, 60, 45].map((len, i) => ({ id: `v${i + 1}`, mediaId: 'm', in: 0, len, volume: 1, transition: i === 1 ? 10 : 0 })),
    audio: [{ id: 'a4', mediaId: 'm', start: 0, in: 0, len: 195, volume: 1 }],
    text: [0, 90].map((start, i) => ({ id: `t${i + 5}`, text: 'Title', start, len: 45, x: .5, y: .85, size: 6 })),
});
