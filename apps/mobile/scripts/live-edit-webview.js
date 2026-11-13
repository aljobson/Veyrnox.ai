/* global Vision, LIVE_ASSETS, ReactNativeWebView */
// Prepared into a local HTML document. No remote URL, upload, analytics or storage API.
(() => {
    let face, hair, busy = false, initialized = false;
    const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
    const post = data => ReactNativeWebView.postMessage(JSON.stringify(data));
    const validId = n => Number.isSafeInteger(n) && n > 0 && n < 1000000;
    async function init() {
        if (initialized) return;
        const files = { wasmLoaderPath: LIVE_ASSETS.loader, wasmBinaryPath: LIVE_ASSETS.wasm };
        face = await Vision.FaceLandmarker.createFromOptions(files, {
            baseOptions: { modelAssetBuffer: decode(LIVE_ASSETS.face), delegate: 'CPU' },
            numFaces: 2, runningMode: 'IMAGE', outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
        });
        hair = await Vision.ImageSegmenter.createFromOptions(files, {
            baseOptions: { modelAssetBuffer: decode(LIVE_ASSETS.hair), delegate: 'CPU' },
            runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
        });
        if (hair.getLabels().join(',') !== 'background,hair,body-skin,face-skin,clothes,others') throw Error('labels');
        delete LIVE_ASSETS.face; delete LIVE_ASSETS.hair;
        initialized = true;
    }
    window.liveEditReceive = async raw => {
        let request;
        try { if (typeof raw !== 'string' || raw.length > 901000) return; request = JSON.parse(raw); } catch { return; }
        if (!request || !validId(request.id) || !['init', 'detect'].includes(request.op)) return;
        if (busy) { post({ id: request.id, error: true }); return; }
        busy = true;
        let image, canvas;
        try {
            if (request.op === 'init') { await init(); post({ id: request.id, ready: true }); return; }
            const { sourceId, frameId, width, height, jpeg } = request;
            if (!initialized || !validId(sourceId) || !validId(frameId) || !Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < 8 || Math.max(width, height) > 384 || typeof jpeg !== 'string' || jpeg.length > 900000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(jpeg)) throw Error('frame');
            image = new Image();
            await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = jpeg; });
            if (image.naturalWidth !== width || image.naturalHeight !== height) throw Error('size');
            canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(image, 0, 0);
            const result = face.detect(canvas), count = Math.min(2, result.faceLandmarks.length);
            if (count !== 1) { post({ id: request.id, sourceId, frameId, count, landmarks: [], hair: null }); return; }
            const landmarks = result.faceLandmarks[0].flatMap(p => [p.x, p.y, p.z]);
            if (landmarks.length !== 1434 || landmarks.some(v => !Number.isFinite(v) || Math.abs(v) > 2)) throw Error('landmarks');
            const segmentation = hair.segment(canvas);
            try {
                if (segmentation.confidenceMasks?.length !== 6) throw Error('channels');
                const mask = segmentation.confidenceMasks[1], values = mask.getAsFloat32Array();
                if (Math.min(mask.width, mask.height) < 8 || Math.max(mask.width, mask.height) > 512 || values.length !== mask.width * mask.height || values.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw Error('mask');
                post({ id: request.id, sourceId, frameId, count, landmarks, width: mask.width, height: mask.height, hair: Array.from(values, v => Math.round(v * 255)) });
            } finally { segmentation.close(); }
        } catch { post({ id: request.id, error: true }); }
        finally { if (image) image.src = ''; if (canvas) canvas.width = canvas.height = 1; busy = false; }
    };
    window.addEventListener('pagehide', () => { face?.close(); hair?.close(); face = hair = null; });
})();
