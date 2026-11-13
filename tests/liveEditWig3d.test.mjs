import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { WIGS_3D, THREE_VERSION, THREE_URL, HEAD, headFrame, wigMatrix, wig3dFade, buildWigMesh, faceWindowGlsl, inFaceWindow, isWig3d, normalizeWigWeb } from '../packages/live-edit/wig3d.js';
import { normalizeWig } from '../packages/live-edit/wigFit.js';

// Same synthetic geometry the browser proof uses, built without a canvas.
import { wigPoints } from './fixtures/photo-studio-wig-fixture.mjs';
const near = (a, b, eps = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) <= eps);
const yawed = (points, degrees) => {
    const out = points.slice(), c = Math.cos(degrees * Math.PI / 180), s = Math.sin(degrees * Math.PI / 180);
    for (let i = 0; i < 478; i++) { if (!out[i * 3] && !out[i * 3 + 1]) continue; const dx = out[i * 3] * 256 - 128; out[i * 3] = (128 + dx * c) / 256; out[i * 3 + 2] = -dx * s / 256; }
    return out;
};

test('head frame of a frontal face: right, up, forward and sizes', () => {
    const frame = headFrame(wigPoints(), 256, 256);
    assert.ok(frame);
    assert.ok(near(frame.right, [1, 0, 0]) && near(frame.up, [0, -1, 0]) && near(frame.forward, [0, 0, 1]), JSON.stringify(frame));
    assert.ok(frame.s > 40 && frame.s < 70 && frame.h > 100 && frame.h < 170);
});

test('head frame follows a yaw and stays orthonormal', () => {
    const frame = headFrame(yawed(wigPoints(), 30), 256, 256), rad = 30 * Math.PI / 180;
    assert.ok(near(frame.right, [Math.cos(rad), 0, Math.sin(rad)], .03), JSON.stringify(frame.right));
    assert.ok(Math.abs(frame.forward[2] - Math.cos(rad)) < .03);
    for (const [a, b] of [[frame.right, frame.up], [frame.up, frame.forward], [frame.right, frame.forward]]) assert.ok(Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) < 1e-3);
});

test('head frame refuses bad input', () => {
    assert.equal(headFrame(null, 256, 256), null);
    assert.equal(headFrame(new Float32Array(1434), 256, 256), null);
    const bad = wigPoints(); bad[234 * 3] = NaN;
    assert.equal(headFrame(bad, 256, 256), null);
    assert.equal(headFrame(wigPoints(), 0, 256), null);
});

test('matrix scales by size and moves down for a positive offset', () => {
    const frame = headFrame(wigPoints(), 256, 256), base = wigMatrix(frame, { size: 1, offset: 0 });
    const big = wigMatrix(frame, { size: 1.2, offset: 0 }), low = wigMatrix(frame, { size: 1, offset: .1 });
    assert.ok(Math.abs(big[0] / base[0] - 1.2) < 1e-6);
    assert.ok(low[13] > base[13], 'positive offset moves toward larger y (down the image)');
    assert.equal(base.length, 16); assert.ok(base.every(Number.isFinite));
});

test('fade: full when frontal, none when far turned', () => {
    assert.equal(wig3dFade(wigPoints(), 256, 256), 1);
    assert.ok(wig3dFade(yawed(wigPoints(), 50), 256, 256) < 1);
    assert.equal(wig3dFade(yawed(wigPoints(), 75), 256, 256), 0);
});

test('meshes are finite, closed grids with strand colours, ordered by length', () => {
    const lows = {};
    for (const wig of WIGS_3D) {
        const mesh = buildWigMesh(wig.id);
        assert.ok(mesh.positions.every(Number.isFinite) && mesh.colors.every(Number.isFinite));
        assert.ok(mesh.indices.every(i => i < mesh.vertices) && mesh.indices.length === 64 * 44 * 6);
        lows[wig.id] = Math.min(...mesh.positions.filter((_, i) => i % 3 === 1));
    }
    assert.ok(lows['3d-pixie'] > lows['3d-bob'] && lows['3d-bob'] > lows['3d-long'], JSON.stringify(lows));
    assert.equal(buildWigMesh('3d-nope'), null);
});

test('the face opening: in front, between the temples, under the hairline; never the dome, back or sides', () => {
    for (const wig of WIGS_3D) {
        assert.ok(inFaceWindow(wig.id, 0, .2, .9), `${wig.id}: centre of the face is open`);
        assert.ok(inFaceWindow(wig.id, .5, 0, .8) && inFaceWindow(wig.id, -.5, 0, .8));
        assert.ok(!inFaceWindow(wig.id, 0, .95, .5), `${wig.id}: the dome stays`);
        assert.ok(!inFaceWindow(wig.id, 0, .2, -.9), `${wig.id}: the back stays`);
        assert.ok(!inFaceWindow(wig.id, 1.05, .2, .3), `${wig.id}: the temples stay`);
        const glsl = faceWindowGlsl(wig.id);
        assert.match(glsl, /discard/); assert.match(glsl, /vLocal\.z > 0\.1/); assert.match(glsl, /0\.9800/);
        assert.doesNotMatch(glsl, /pow\(/, 'pow() of a negative base is undefined in GLSL ES; square by multiplication');
        assert.match(glsl, /fx \* fx/);
    }
    assert.ok(!inFaceWindow('3d-fringe', 0, .5, .9) && inFaceWindow('3d-pixie', 0, .5, .9), 'a fringe hangs lower over the forehead than a pixie crop');
    assert.equal(faceWindowGlsl('nope'), null); assert.equal(inFaceWindow('nope', 0, 0, 1), false);
});

test('the wig shell sits outside the head proxy so it never z-fights the occluder', () => {
    const [cx, cy, cz] = HEAD.centre, [rx, ry, rz] = HEAD.radii;
    for (const wig of WIGS_3D) {
        const mesh = buildWigMesh(wig.id);
        for (let v = 0; v < mesh.vertices; v++) {
            const x = mesh.positions[v * 3], y = mesh.positions[v * 3 + 1], z = mesh.positions[v * 3 + 2];
            if (y < cy - .05) continue; // the skirt hangs below the skull
            assert.ok(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 > 1.0001, `${wig.id} vertex inside the proxy`);
        }
    }
});

test('web normalizer accepts 3D ids and leaves the shared 2D normalizer alone', () => {
    assert.equal(normalizeWigWeb({ style: '3d-bob', size: 9, strength: 2 }).style, '3d-bob');
    assert.equal(normalizeWigWeb({ style: '3d-bob', size: 9 }).size, 1.3);
    assert.equal(normalizeWigWeb({ style: '3d-nope' }).style, 'none');
    assert.equal(normalizeWigWeb({ style: 'pixie' }).style, 'pixie');
    assert.equal(normalizeWig({ style: '3d-bob' }).style, 'none', 'mobile-shared normalizer must not learn 3D ids');
    assert.ok(isWig3d('3d-long') && !isWig3d('long'));
});

test('every 3D wig is original, owned and named', () => {
    for (const wig of WIGS_3D) assert.ok(wig.licence === 'owned' && /authored by Veyrnox/.test(wig.source) && /^app\.photoStudio\.wig3d\./.test(wig.nameKey));
    assert.equal(new Set(WIGS_3D.map(w => w.id)).size, WIGS_3D.length);
});

test('vendored three.js matches the pinned package, its manifest and the licence', () => {
    const lock = JSON.parse(readFileSync('package.json', 'utf8')).devDependencies.three;
    assert.equal(lock, THREE_VERSION, 'package.json pins the exact version the loader URL names');
    const dir = `public/photo-studio/vendor/three-${THREE_VERSION}`, manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
    assert.equal(manifest.version, THREE_VERSION); assert.equal(manifest.licence, 'MIT');
    assert.ok(THREE_URL.startsWith(`/${dir.replace('public/', '')}/`) && /^\/[a-z0-9\-/.]+$/.test(THREE_URL), 'a same-origin path');
    assert.match(readFileSync(`${dir}/LICENSE`, 'utf8'), /MIT License/);
    for (const [name, hash] of Object.entries(manifest.files)) {
        assert.equal(createHash('sha256').update(readFileSync(`${dir}/${name}`)).digest('hex'), hash, `${name} matches the manifest`);
        if (existsSync(`node_modules/three/build/${name}`)) assert.equal(createHash('sha256').update(readFileSync(`node_modules/three/build/${name}`)).digest('hex'), hash, `${name} matches node_modules`);
    }
});

test('a failed 3D load rejects prepare (so export is refused), reports unavailable, and retries on the next prepare', async () => {
    const element = () => ({ width: 0, height: 0, getContext: () => ({ clearRect() {}, drawImage() {} }) });
    globalThis.document = { createElement: element };
    try {
        const { createWig3dLayer } = await import('../app/veyrnox/_lib/liveEdit/wig3dLayer.js');
        let changes = 0; const layer = createWig3dLayer(256, 256, () => { changes++; });
        // In Node the same-origin path does not exist, which is exactly a failed module request.
        await assert.rejects(layer.prepare('3d-bob'), /wig-unavailable/);
        assert.ok(changes > 0, 'the parent is told so it can redraw');
        assert.equal(layer.render({ style: '3d-bob', strength: 1, size: 1, offset: 0 }, new Float32Array(1434), null).status, 'unavailable');
        await assert.rejects(layer.prepare('3d-bob'), /wig-unavailable/, 'prepare retries from scratch instead of staying broken');
        await layer.prepare('pixie'); // a 2D style is not this layer's business
        layer.close(); layer.close();
    } finally { delete globalThis.document; }
});
