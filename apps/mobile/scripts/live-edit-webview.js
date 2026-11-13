/* global Vision, LIVE_ASSETS, ReactNativeWebView */
// Prepared into a local HTML document. No remote URL, upload, analytics or storage API.
(() => {
    // Camera capability is granted by the app per document: only the visible live view loads this page with `#live`. Every other
    // document (the hidden still-photo and 3D-wig views) gets a getUserMedia that always refuses, and live.* operations are rejected.
    const liveAllowed = typeof location !== 'undefined' && location.hash === '#live';
    if (!liveAllowed && typeof navigator !== 'undefined' && navigator.mediaDevices) {
        const refuse = () => Promise.reject(new DOMException('The camera is not available in this document.', 'NotAllowedError'));
        // Both the instance and the prototype method, so MediaDevices.prototype.getUserMedia.call(...) cannot reach the real one either.
        for (const target of [navigator.mediaDevices, typeof MediaDevices !== 'undefined' ? MediaDevices.prototype : null]) {
            if (target) { try { Object.defineProperty(target, 'getUserMedia', { value: refuse, configurable: false, writable: false }); } catch { /* read-only already */ } }
        }
    }
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
        if (request && typeof request.op === 'string' && request.op.startsWith('live.')) { void liveReceive(request); return; }
        if (request && request.op === 'wig3d') { void wig3dReceive(request); return; }
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

    // ---- Live camera (the visible WebView only). Same engine as the web Photo Studio; models never leave this document. ----
    let session, engine, canvas, video, controller, unwatch, facing = 'user', pendingSettings, starting = false, liveGen = 0;
    const liveOk = () => typeof VeyrnoxLive === 'object';
    const mirror = () => { if (canvas) canvas.style.transform = facing === 'environment' ? 'none' : 'scaleX(-1)'; };
    function liveTeardown() {
        liveGen++; // any start still awaiting init/camera sees a newer generation and gives up
        try { unwatch?.(); } catch { /* detached */ }
        try { controller?.abort(); } catch { /* already aborted */ }
        try { engine?.close(); } catch { /* context already lost */ }
        try { session?.stop(); } catch { /* already stopped */ }
        unwatch = controller = engine = session = undefined; pendingSettings = undefined;
        canvas?.remove(); video?.remove(); canvas = video = undefined; starting = false;
    }
    // `detail` is the underlying error name/message (no user data), only for diagnosing a device that reports a generic code.
    function liveFail(code, error) { liveTeardown(); post({ live: 'error', code: String(code).slice(0, 40), detail: error ? `${error.name || ''}:${error.message || ''}`.slice(0, 120) : undefined }); }
    function liveElements() {
        // CSSOM, not style attributes: the page CSP forbids inline styles.
        document.documentElement.style.cssText = 'height:100%;background:#000';
        document.body.style.cssText = 'margin:0;height:100%;background:#000;overflow:hidden';
        canvas = document.createElement('canvas'); video = document.createElement('video');
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000';
        video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none'; // not display:none: some engines stop decoding it
        video.muted = true; video.playsInline = true; video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
        document.body.append(canvas, video);
    }
    const liveProcessor = async () => {
        face.setOptions({ runningMode: 'VIDEO' });
        return {
            detect: async frame => {
                const result = face.detectForVideo(frame, performance.now()), count = Math.min(2, result.faceLandmarks.length);
                if (count !== 1) return { count, landmarks: new Float32Array() };
                const points = result.faceLandmarks[0], out = new Float32Array(1434);
                if (points.length !== 478) throw Error('landmarks');
                for (let i = 0; i < 478; i++) { out[i * 3] = points[i].x; out[i * 3 + 1] = points[i].y; out[i * 3 + 2] = points[i].z; }
                if (out.some(v => !Number.isFinite(v) || Math.abs(v) > 2)) throw Error('landmarks');
                return { count, landmarks: out };
            },
            close() {},
        };
    };
    async function liveStart(request) {
        if (!liveOk()) { post({ live: 'error', code: 'live-unavailable' }); return; }
        if (starting || engine) { post({ live: 'error', code: 'live-busy' }); return; }
        starting = true; const gen = ++liveGen, mine = () => gen === liveGen;
        try {
            await init();
            if (!mine()) return; // stopped while the models were loading: never touch the camera
            liveElements(); controller = new AbortController();
            const deviceId = typeof request.deviceId === 'string' && request.deviceId.length < 300 ? request.deviceId : undefined;
            unwatch = VeyrnoxLive.stopWhenHidden(() => { controller?.abort(); session?.stop(); }, () => liveFail('camera-hidden'));
            const opened = await VeyrnoxLive.startCamera({ video, deviceId, signal: controller.signal, onEnded: () => liveFail('camera-lost') });
            if (!mine()) { opened.stop(); return; }
            session = opened;
            facing = session.settings?.facingMode === 'environment' ? 'environment' : 'user'; mirror();
            const instance = VeyrnoxLive.createLiveEngine(canvas, video, {
                onFace: status => post({ live: 'face', status }), onWig: status => post({ live: 'wig', status }), onError: code => liveFail(code),
                onResize: () => mirror(), processorFactory: liveProcessor,
            });
            engine = instance;
            if (pendingSettings) instance.setSettings(pendingSettings);
            await instance.ready;
            if (engine !== instance) return; // stopped while starting
            const cameras = await VeyrnoxLive.listCameras().catch(() => []);
            post({ live: 'started', width: video.videoWidth, height: video.videoHeight, cameras: cameras.length });
        } catch (error) { liveFail(error?.name === 'AbortError' ? 'camera-hidden' : VeyrnoxLive.cameraErrorCode(error), error); }
        finally { if (mine()) starting = false; }
    }
    async function liveSwitch() {
        if (!engine || !session || starting) return;
        starting = true; const old = session;
        try {
            const cameras = await VeyrnoxLive.listCameras(), current = cameras.findIndex(c => c.deviceId === old.settings?.deviceId);
            const next = cameras[(Math.max(0, current) + 1) % cameras.length];
            old.stop();
            session = await VeyrnoxLive.startCamera({ video, deviceId: next?.deviceId, signal: controller.signal, onEnded: () => liveFail('camera-lost') });
            facing = session.settings?.facingMode === 'environment' ? 'environment' : 'user'; mirror();
        } catch (error) { liveFail(error?.name === 'AbortError' ? 'camera-hidden' : VeyrnoxLive.cameraErrorCode(error), error); }
        finally { starting = false; }
    }
    function liveCapture(request) {
        // The raw frame (no effects, not mirrored): the normal still flow then applies hair and wig coverage at full quality.
        if (!video || video.readyState < 2 || !video.videoWidth) { post({ live: 'error', code: 'camera-not-ready', id: request.id }); return; }
        const still = document.createElement('canvas'); still.width = video.videoWidth; still.height = video.videoHeight;
        try { still.getContext('2d').drawImage(video, 0, 0); post({ live: 'photo', id: request.id, width: still.width, height: still.height, jpeg: still.toDataURL('image/jpeg', 0.92) }); }
        catch { post({ live: 'error', code: 'export-failed', id: request.id }); }
        finally { still.width = still.height = 1; }
    }
    async function liveReceive(request) {
        if (!liveAllowed) { post({ live: 'error', code: 'live-unavailable' }); return; }
        try {
            switch (request.op) {
            case 'live.start': await liveStart(request); break;
            case 'live.settings':
                if (request.settings && typeof request.settings === 'object') { pendingSettings = request.settings; engine?.setSettings(request.settings); }
                break;
            case 'live.compare': engine?.compare(request.value === true); break;
            case 'live.switch': await liveSwitch(); break;
            case 'live.capture': liveCapture(request); break;
            case 'live.stop': liveTeardown(); post({ live: 'stopped' }); break;
            default: break;
            }
        } catch (error) { liveFail(error?.message || 'live-failed'); }
    }

    // ---- 3D wig overlay for a still photo (the hidden WebView). three.js runs here; the app composites the returned PNG. ----
    let wigLayer, wigSize = '';
    async function wig3dReceive(request) {
        const reply = data => post({ id: request.id, wig3d: true, ...data });
        try {
            const { width, height, landmarks } = request;
            if (!liveOk() || !validId(request.id) || typeof request.style !== 'string' || !VeyrnoxLive.isWig3d(request.style)
                || !Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < 8 || Math.max(width, height) > 8192
                || !Array.isArray(landmarks) || landmarks.length !== 1434 || landmarks.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 2)) { reply({ status: 'unavailable' }); return; }
            if (!wigLayer || wigSize !== `${width}x${height}`) { wigLayer?.close(); wigLayer = VeyrnoxLive.createWig3dLayer(width, height); wigSize = `${width}x${height}`; }
            await wigLayer.prepare(request.style);
            // Strength 1 here: the app applies the person's strength and the pose fade itself, so one overlay serves every strength.
            const out = wigLayer.render({ style: request.style, size: Number(request.size) || 1, offset: Number(request.offset) || 0, strength: 1 }, Float32Array.from(landmarks), null);
            if (!out.active) { reply({ status: out.status === 'angle' || out.status === 'face-required' ? out.status : 'unavailable' }); return; }
            reply({ status: 'ready', fade: out.opacity, width: out.image.width, height: out.image.height, png: out.image.toDataURL('image/png') });
        } catch { reply({ status: 'unavailable' }); }
    }
    window.addEventListener('pagehide', () => { liveTeardown(); wigLayer?.close(); wigLayer = undefined; face?.close(); hair?.close(); face = hair = null; });
})();
