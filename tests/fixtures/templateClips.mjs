export const id = 'medieval-runway-look';
export const manifest = { [id]: { key: `template-clips/${id}/${'a'.repeat(64)}.mp4`, version: 'v1', sha256: 'a'.repeat(64), seconds: 5, videoSeconds: 5, width: 406, height: 720, contentType: 'video/mp4' } };
export const catalog = [{ id: 'seedance-2.0-reference', name: 'Seedance 2.0 · Reference', provider: 'fal', provider_endpoint: 'bytedance/seedance-2.0/reference-to-video', modality: 'image-to-video', credits_5s: 85, active: true, gated_flag: false }];

export const kieCatalog = { ...catalog[0], id: 'seedance-2.0-reference-kie', name: 'Seedance 2.0 · Reference · kie', provider: 'kie', provider_endpoint: 'market:bytedance/seedance-2', credits_5s: 70 };
export const kieSource = { ...manifest[id], width: 1280, height: 720, pixels: 921600, frameRate: 30, sizeBytes: 1000000 };
