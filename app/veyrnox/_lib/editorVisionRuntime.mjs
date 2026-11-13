export const EDITOR_VISION_VERSION = 'mediapipe-1.0.1-multiclass-1-c6748b12-worker-1';
export const EDITOR_VISION_PATH = `/editor-vision/${EDITOR_VISION_VERSION}`;
export const EDITOR_VISION_MODEL_SHA256 = 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0';
export const EDITOR_VISION_LIMITS = Object.freeze({ inputEdge: 384, maskEdge: 512, sourceSeconds: 10, outputHeight: 720 });
export const FACE_VISION_VERSION = 'mediapipe-1.0.1-facelandmarker-1-64184e22-worker-2';
export const FACE_VISION_PATH = `/editor-vision/${FACE_VISION_VERSION}`;
export function editorVisionWorkerPolicy(publicOrigin, path = EDITOR_VISION_PATH) {
    if (![EDITOR_VISION_PATH, FACE_VISION_PATH].includes(path)) throw new Error('Unknown vision runtime.');
    const origin = new URL(publicOrigin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Choose an exact public origin.');
    const assets = `${origin.origin}${path}/`;
    return `default-src 'none'; script-src ${assets} 'wasm-unsafe-eval'; connect-src ${assets}; worker-src 'none'; base-uri 'none'; object-src 'none'`;
}
