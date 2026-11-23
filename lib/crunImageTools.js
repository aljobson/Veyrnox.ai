// Two Crun-only image tools: background removal and a 2x upscale. Contracts: docs.crun.ai/ai-tools/image-background-remove.md and
// image-upscale.md (read 2026-11-23). Owner probes 2026-11-23 (Crun prod key):
//   image-background-remove  0.5 credits ($0.0024), 4-7 s; 1024x1536 JPEG in, 1024x1536 RGBA PNG out, edges clean; 480x720 fine.
//   image-upscale 2x clean   3 credits ($0.0146), 11-14 s; 480x720 in -> 960x1440 out (enlarged); 1024x1536 in -> 1024x1536 out
//                            (NOT enlarged, still charged). Crun's own rule: a long edge of 512 to 1024 px is doubled, above 1024
//                            is returned at its size, so the upscale pins a 1024 px long edge. 1024 itself is confirmed on the website.
// They are NEW offers, not routes of Bria or Topaz (a different model), so there is no fal route and no failover.
// Endpoint names are Crun's own model ids: `crun:image-background-remove`, `crun:image-upscale`.
export const CRUN_BG_REMOVE_MODEL = 'image-background-remove';
export const CRUN_UPSCALE_MODEL = 'image-upscale';
export const CRUN_IMAGE_TOOL_MODELS = Object.freeze([CRUN_BG_REMOVE_MODEL, CRUN_UPSCALE_MODEL]);
export const CRUN_UPSCALE_MAX_EDGE = 1024;
export const CRUN_BG_REMOVE_MAX_EDGE = 4096;
// Crun documents 20 MB for the upscale input; the cutout page names no limit, so the same one is applied.
const MAX_BYTES_EXCLUSIVE = 20_000_001;

const DOCS_BG = 'https://docs.crun.ai/ai-tools/image-background-remove.md';
const DOCS_UP = 'https://docs.crun.ai/ai-tools/image-upscale.md';
const isHttps = (value) => {
    try { return typeof value === 'string' && new URL(value).protocol === 'https:'; } catch { return false; }
};

export const CRUN_BG_REMOVE_CAPABILITY = Object.freeze({
    provider: 'crun', kind: 'image', verifiedAt: '2026-11-23', verification: DOCS_BG,
    inputs: {}, rename: {},
    media: { image: { field: 'img_urls', required: true, maxSide: CRUN_BG_REMOVE_MAX_EDGE, maxBytesExclusive: MAX_BYTES_EXCLUSIVE, verifiedAt: '2026-11-23', verification: DOCS_BG } },
    lengths: null,
    fixed: { model: CRUN_BG_REMOVE_MODEL },
    assumes: {},
});

export const CRUN_UPSCALE_CAPABILITY = Object.freeze({
    provider: 'crun', kind: 'image', verifiedAt: '2026-11-23', verification: DOCS_UP,
    inputs: {}, rename: {},
    media: { image: { field: 'img_urls', required: true, maxSide: CRUN_UPSCALE_MAX_EDGE, maxBytesExclusive: MAX_BYTES_EXCLUSIVE, verifiedAt: '2026-11-23', verification: DOCS_UP } },
    lengths: null,
    fixed: { model: CRUN_UPSCALE_MODEL, scale_factor: 2, mode: 'clean', output_format: 'png' },
    assumes: {},
});

/** Crun CreateTask body for one of the two tools, or a typed refusal. One image, nothing else is accepted. */
export function buildCrunImageToolRequest(model, inputs) {
    if (!CRUN_IMAGE_TOOL_MODELS.includes(model)) return { ok: false, error: 'provider_unsupported' };
    const extra = Object.keys(inputs).find(key => key !== 'image_url');
    if (extra) return { ok: false, error: `inputs_key_not_allowed:${extra.slice(0, 32)}` };
    const images = [inputs.image_url].flat().filter(value => value !== undefined);
    if (images.length !== 1 || !isHttps(images[0])) return { ok: false, error: 'inputs_invalid:image_url' };
    const input = model === CRUN_UPSCALE_MODEL
        ? { img_urls: [images[0]], scale_factor: 2, mode: 'clean', output_format: 'png' }
        : { img_urls: [images[0]] };
    return { ok: true, body: { model, input } };
}
