// Crun Kling O1 reference-to-video for template swaps only (docs.crun.ai/models/kling/o1-reference-to-video.json, read
// 2026-11-22). The public offer never reaches it: the private catalog row is chosen by swap admission. The adapter builds
// the request; `field` names here only document Crun's fields. Output length follows the base video, so no length is sent.
const DOCS = 'https://docs.crun.ai/models/kling/o1-reference-to-video.json';

export const KLING_O1_SWAP_CAPABILITY = Object.freeze({
    provider: 'crun', kind: 'video',
    inputs: { prompt: { type: 'string', max: 2500 } }, rename: {},
    media: {
        video: { field: 'reference_videos', required: true, minSeconds: 3, maxSeconds: 10, minSide: 700, maxSide: 2160, minFrameRate: 24, maxFrameRate: 60, verifiedAt: '2026-11-22', verification: DOCS },
        image: { field: 'reference_images', required: true, list: true, max: 5, minSide: 300, label: 'Reference pictures', verifiedAt: '2026-11-22', verification: DOCS, priceVerification: 'https://crun.ai/pricing' },
    },
    lengths: { field: 'duration', map: { 5: 5 } },
    fixed: { model: 'kling/o1-r2v', reference_video_type: 'base_video', resolution: '720p', aspect_ratio: 'auto', audio: false },
    assumes: {},
});
