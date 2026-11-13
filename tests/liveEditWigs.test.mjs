import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { WIGS } from '../packages/live-edit/wigs.js';
import { OVAL } from '../packages/live-edit/regions.js';
import { similarity, transformPoint, fitWig, normalizeWig, wigPose, wigCoverage, wigEdgeAlpha, protectedFace } from '../packages/live-edit/wigFit.js';
import { createHistory, DEFAULTS } from '../app/veyrnox/_lib/liveEdit/settings.js';
import { wigPoints, longHairMask } from './fixtures/photo-studio-wig-fixture.mjs';
import { contentSecurityPolicy } from '../lib/contentSecurityPolicy.mjs';
import messages from '../lib/i18n/photoStudioEnglish.mjs';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-4, `${a} != ${b}`);

test('six original wig assets have hashes, local SVG-only content, dimensions, provenance and SDK anchors', async () => {
    const pkg = JSON.parse(await readFile(new URL('../node_modules/@mediapipe/tasks-vision/package.json', import.meta.url)));
    assert.equal(pkg.version, '1.0.1'); assert.equal(WIGS.length, 6); assert.equal(new Set(WIGS.map(w => w.id)).size, 6);
    const vertices = new Set(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.flatMap(e => [e.start, e.end]));
    for (const wig of WIGS) {
        assert.equal(wig.source, 'authored by Veyrnox in code'); assert.equal(wig.licence, 'owned'); assert.ok(messages[wig.nameKey]);
        assert.match(wig.file, /^\/photo-studio\/wigs\/[a-z]+\.svg$/);
        const bytes = await readFile(new URL(`../public${wig.file}`, import.meta.url)), svg = bytes.toString();
        assert.equal(createHash('sha256').update(bytes).digest('hex'), wig.sha256);
        assert.deepEqual(wig.dimensions, [512, 640]); assert.match(svg, /width="512" height="640" viewBox="0 0 512 640"/);
        // Namespace is an XML identifier, not a resource URL. All resource references are local IDs.
        const body = svg.replace('xmlns="http://www.w3.org/2000/svg"', '');
        assert.doesNotMatch(body, /https?:|\/\/|href\s*=|<\s*(?:script|foreignObject|image|style|animate|set)\b|\bon\w+\s*=|<!|data:|@import/i);
        for (const url of body.matchAll(/url\(([^)]+)\)/g)) assert.match(url[1], /^#[a-z]+$/);
        assert.match(svg, /mask="url\(#opening\)"/); assert.match(svg, /<mask[^>]+id="opening"/);
        assert.equal(wig.anchors.length, 5);
        for (const a of wig.anchors) { assert.ok(vertices.has(a.landmark) && OVAL.includes(a.landmark)); assert.equal(a.position.length, 2); a.position.forEach((v, i) => assert.ok(v > 0 && v < wig.dimensions[i])); }
    }
    assert.match(contentSecurityPolicy(), /img-src 'self'/);
    // Actual Image decode + face-opening transparency under this CSP is a host GPU proof.
});

test('similarity follows synthetic translation, scale and roll sequences including rectangular photos', () => {
    const from = WIGS[0].anchors.map(a => a.position);
    for (const scale of [.2, .4, 1.2]) for (const roll of [-.7, 0, .8]) for (const offset of [-25, 40]) {
        const expected = { a: scale * Math.cos(roll), b: scale * Math.sin(roll), tx: offset, ty: 55 };
        const to = from.map(p => transformPoint(expected, p)), m = similarity(from, to);
        for (const key of ['a', 'b', 'tx', 'ty']) near(m[key], expected[key]);
        const points = wigPoints(); WIGS[0].anchors.forEach((a, i) => { points[a.landmark * 3] = to[i][0] / 640; points[a.landmark * 3 + 1] = to[i][1] / 480; });
        const fit = fitWig(WIGS[0], points, 640, 480, {});
        from.forEach((p, i) => transformPoint(fit, p).forEach((v, axis) => near(v, to[i][axis])));
    }
    assert.equal(similarity([[1, 1], [1, 1]], [[2, 2], [3, 3]]), null);
    assert.equal(fitWig(WIGS[0], null, 256, 256, {}), null);
    assert.equal(fitWig(WIGS[0], new Float32Array(1434).fill(NaN), 256, 256, {}), null);
});

test('clamps and forehead-pivot adjustments survive one shared undo/redo timeline with tint', () => {
    assert.deepEqual(normalizeWig({ style: 'bad', size: 20, offset: -9, strength: -1 }), { style: 'none', size: 1.3, offset: -.15, strength: 0 });
    assert.deepEqual(normalizeWig({ size: NaN, offset: Infinity, strength: NaN }), DEFAULTS.wig);
    const history = createHistory(); history.set({ ...history.value, wig: { style: 'bob', size: 1.1, offset: .1, strength: .8 }, hair: { strength: .7, shade: 'plum' } });
    const edited = history.value; edited.wig.style = 'long'; assert.equal(history.value.wig.style, 'bob');
    history.undo(); assert.deepEqual(history.value, DEFAULTS); history.redo(); assert.equal(history.value.wig.size, 1.1); assert.equal(history.value.hair.shade, 'plum');
    const p = wigPoints(), first = fitWig(WIGS[0], p, 256, 256, {}), sized = fitWig(WIGS[0], p, 256, 256, { size: 1.3 });
    transformPoint(first, WIGS[0].anchors[0].position).forEach((v, i) => near(v, transformPoint(sized, WIGS[0].anchors[0].position)[i]));
    const shifted = fitWig(WIGS[0], p, 256, 256, { offset: .1 }); near(shifted.ty - first.ty, 20.48);
});

test('yaw and pitch fade from 20 to 35 degrees, no landmarks off, roll does not change fade', () => {
    for (const axis of [[234, 454], [10, 152]]) {
        let previous = 1;
        for (const degrees of [0, 20, 25, 30, 35, 60]) {
            const points = wigPoints(), [a, b] = axis;
            const span = Math.hypot(points[a * 3] - points[b * 3], points[a * 3 + 1] - points[b * 3 + 1]);
            points[a * 3 + 2] = Math.tan(degrees * Math.PI / 180) * span;
            const pose = wigPose(points, 256, 256); assert.ok(pose.fade <= previous + 1e-6); previous = pose.fade;
            if (degrees <= 20) near(pose.fade, 1); if (degrees >= 35) near(pose.fade, 0);
            for (let i = 0; i < 478; i++) { const x = points[i * 3], y = points[i * 3 + 1]; points[i * 3] = -y; points[i * 3 + 1] = x; }
            near(wigPose(points, 256, 256).fade, pose.fade);
        }
    }
    assert.equal(wigPose(null, 256, 256).fade, 0);
    assert.ok(protectedFace(wigPoints()).length >= 30);
});

test('long natural hair under a short silhouette stays opaque; uncovered coverage announces R4 hint', () => {
    const mask = longHairMask(), alpha = Float32Array.from(mask.hair, (v, i) => Math.floor(i / mask.width) < 30 ? v : 0);
    assert.ok(wigCoverage(mask, alpha).fraction > .15); assert.equal(wigCoverage(mask, alpha).hint, true);
    assert.equal(wigCoverage(mask, mask.hair).hint, false); assert.equal(wigCoverage(mask, mask.hair, .5).hint, true);
    assert.equal(wigCoverage(null, alpha).known, false);
    assert.equal(wigCoverage({ ...mask, hair: new Float32Array(alpha.length) }, alpha).hint, false);
    for (const confidence of [0, .5, 1]) for (const opacity of [0, .2, 1]) for (const a of [0, .2, .5, 1]) {
        const coverage = wigEdgeAlpha(a, confidence) * opacity;
        near(coverage + 1 * (1 - coverage), 1); // Porter-Duff source-over cannot punch a hole.
        if (!a || !opacity) assert.equal(coverage, 0);
        if (a === 1) near(coverage, opacity);
    }
    // GPU proof below additionally checks every source pixel, actual SVG and export.
});
