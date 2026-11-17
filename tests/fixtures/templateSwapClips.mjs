export const id = 'community-action-hero-strut';
export const registry = [id];
export const source = { key: `template-swap-clips/${id}/${'a'.repeat(64)}.mp4`, version: 'v1', sha256: 'a'.repeat(64), seconds: 5, videoSeconds: 5, width: 720, height: 1280, contentType: 'video/mp4', sizeBytes: 1000, frameRate: 24 };
export const manifest = { [id]: source };
export const catalog = [{ id: 'kling-o1-reference', provider: 'fal', provider_endpoint: 'fal-ai/kling-video/o1/video-to-video/reference', modality: 'video-to-video', credits_5s: 47, active: true, gated_flag: false }];
