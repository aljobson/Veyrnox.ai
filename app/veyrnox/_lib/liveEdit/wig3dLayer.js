import { THREE_URL, WIGS_3D, HEAD, buildWigMesh, faceWindowGlsl, headFrame, wigMatrix, wig3dFade } from '../../../../packages/live-edit/wig3d.js';
import { validWigLandmarks } from '../../../../packages/live-edit/wigFit.js';
import { carveFace, sampleCoverage } from './wigCommon.js';

// three.js is a same-origin static module (public/photo-studio/vendor), never bundled: it stays out of the Worker.
let threeLoad;
// The mobile WebView page (no URL space of its own) injects its inlined copy as globalThis.__veyrnoxThree.
const loadThree = () => globalThis.__veyrnoxThree ? Promise.resolve(globalThis.__veyrnoxThree)
    : threeLoad ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ THREE_URL).catch(error => { threeLoad = undefined; throw error; });

/**
 * Same contract as the 2D wig layer: render(settings, landmarks, mask) -> { active, image, key, opacity, coverage, status }.
 * prepare() rejects when the module or graphics cannot start (so an export is refused, never silently wigless);
 * render() never throws. The GPU side is released when the layer closes, and the layer is closed when a
 * non-3D style is chosen. The downloaded module stays cached either way.
 */
export function createWig3dLayer(width, height, onChange = () => {}) {
    const layer = document.createElement('canvas'), sample = document.createElement('canvas');
    const ratio = Math.min(1, 1024 / Math.max(width, height));
    layer.width = Math.max(1, Math.round(width * ratio)); layer.height = Math.max(1, Math.round(height * ratio));
    const makeGl = () => { const canvas = document.createElement('canvas'); canvas.width = layer.width; canvas.height = layer.height; return canvas; };
    const ctx = layer.getContext('2d', { willReadFrequently: true });
    let gl = makeGl(), closed = false, state = 'idle', version = 0, cacheKey, cached, engine, starting, lost = false, shaderFailed = false;
    const meshes = new Map();
    const changed = () => { if (!closed) onChange(); };

    /** Free every GPU object. A canvas whose context was force-lost can never host another, so it is replaced. */
    function release(final) {
        if (engine) {
            engine.canvas.removeEventListener('webglcontextlost', engine.onLost); engine.canvas.removeEventListener('webglcontextrestored', engine.onRestored);
            for (const item of meshes.values()) { item.geometry.dispose(); item.material.dispose(); }
            try { engine.renderer.dispose(); engine.renderer.forceContextLoss?.(); } catch { /* already gone */ }
        }
        meshes.clear(); engine = null; cached = null; cacheKey = null; lost = false; shaderFailed = false;
        gl = final ? null : makeGl();
    }
    // One shared load: a draw can start it before any prepare() call, and prepare() must still wait for it.
    function start() {
        if (closed) return Promise.resolve();
        if (starting) return starting;
        state = 'loading';
        return starting = loadThree().then(THREE => {
            if (closed) return;
            const canvas = gl, renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
            // three.js reports a shader compile/link failure by logging, not throwing: capture it so it is never cached as a wig.
            renderer.debug.onShaderError = () => { shaderFailed = true; };
            renderer.setPixelRatio(1); renderer.setSize(canvas.width, canvas.height, false); renderer.setClearColor(0x000000, 0);
            const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(0, width, 0, height, -4 * width, 4 * width);
            camera.position.z = 2 * width;
            scene.add(new THREE.HemisphereLight(0xffffff, 0x554a42, 1.2));
            const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-.4 * width, -width, 2 * width); scene.add(sun);
            const root = new THREE.Group(); root.matrixAutoUpdate = false; scene.add(root);
            // Depth-only head proxy: hides the back of the wig when the head turns. It never draws colour.
            const proxy = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshBasicMaterial({ colorWrite: false }));
            proxy.scale.set(...HEAD.radii); proxy.position.set(...HEAD.centre); proxy.renderOrder = -1; root.add(proxy);
            // three.js restores its own GL state on 'webglcontextrestored'; these only drop our cached overlay and ask for a redraw.
            const onLost = event => { event.preventDefault(); lost = true; cached = null; cacheKey = null; version++; changed(); };
            const onRestored = () => { lost = false; cached = null; cacheKey = null; version++; changed(); };
            canvas.addEventListener('webglcontextlost', onLost); canvas.addEventListener('webglcontextrestored', onRestored);
            engine = { THREE, renderer, scene, camera, root, canvas, onLost, onRestored };
            state = 'ready'; version++; changed();
        }).catch(() => { release(); state = 'unavailable'; version++; changed(); throw new Error('wig-unavailable'); });
    }
    const broken = () => state === 'unavailable' || lost || (engine && engine.renderer.getContext().isContextLost());
    function mesh(style) {
        if (meshes.has(style)) return meshes.get(style);
        const { THREE } = engine, data = buildWigMesh(style), geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
        geometry.setIndex(new THREE.BufferAttribute(data.indices, 1)); geometry.computeVertexNormals();
        const window = faceWindowGlsl(style);
        const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: 0, side: THREE.DoubleSide });
        material.customProgramCacheKey = () => `wig3d-${style}`;
        material.onBeforeCompile = shader => {
            shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocal;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
            shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocal;').replace('void main() {', `void main() {\n${window}`);
        };
        const item = new THREE.Mesh(geometry, material); item.visible = false; engine.root.add(item);
        meshes.set(style, item); return item;
    }
    return {
        // prepare() is the explicit (re)try path: a broken layer is rebuilt from scratch here, never from render().
        prepare(style) {
            if (!WIGS_3D.some(w => w.id === style)) return Promise.resolve();
            if (!closed && starting && (state === 'unavailable' || (state === 'ready' && broken()))) { release(); starting = null; state = 'idle'; }
            // Draw the chosen wig once now so a shader failure refuses the export instead of being cached as a wig.
            return start().then(() => {
                if (closed || !engine) return;
                try {
                    // A real draw (not compile()) forces three.js to link the program and run its error check now.
                    const item = mesh(style), was = item.visible; item.visible = true;
                    engine.renderer.render(engine.scene, engine.camera); item.visible = was;
                } catch { shaderFailed = true; }
                if (shaderFailed) { release(); starting = null; state = 'unavailable'; version++; changed(); throw new Error('wig-unavailable'); }
            });
        },
        invalidate() { version++; },
        render(settings, points, mask) {
            if (!WIGS_3D.some(w => w.id === settings.style) || settings.strength === 0) return { active: false, status: 'off' };
            if (state === 'idle') start().catch(() => {});
            if (state === 'loading') return { active: false, status: 'loading' };
            if (broken()) return { active: false, status: 'unavailable' };
            if (!validWigLandmarks(points)) return { active: false, status: 'face-required' };
            const frame = headFrame(points, width, height);
            if (!frame) return { active: false, status: 'face-required' };
            const fade = wig3dFade(points, width, height);
            if (fade === 0) return { active: false, status: 'angle' };
            const matrix = wigMatrix(frame, settings), key = JSON.stringify([version, settings, matrix.map(v => Math.round(v * 100)), fade]);
            if (key === cacheKey) return cached;
            const { renderer, scene, camera, root } = engine;
            for (const item of meshes.values()) item.visible = false;
            try {
                mesh(settings.style).visible = true;
                root.matrix.fromArray(matrix); root.matrixWorldNeedsUpdate = true;
                renderer.render(scene, camera);
                // three.js returns silently while the context is lost: never cache an empty frame as a wig.
                if (renderer.getContext().isContextLost()) return { active: false, status: 'unavailable' };
                if (shaderFailed) throw new Error('wig-shader');
            } catch { release(); starting = null; state = 'unavailable'; version++; return { active: false, status: 'unavailable' }; }
            ctx.clearRect(0, 0, layer.width, layer.height); ctx.drawImage(engine.canvas, 0, 0);
            carveFace(ctx, layer, points);
            const opacity = settings.strength * fade, coverage = sampleCoverage(layer, sample, mask, opacity);
            cacheKey = key;
            cached = { active: true, image: layer, key, opacity, coverage,
                status: fade < 1 ? (coverage.hint ? 'angle-uncovered' : 'angle') : coverage.hint ? 'uncovered' : coverage.known ? 'ready' : 'coverage-unknown' };
            return cached;
        },
        close() {
            closed = true; release(true);
            layer.width = layer.height = sample.width = sample.height = 1;
        },
    };
}
