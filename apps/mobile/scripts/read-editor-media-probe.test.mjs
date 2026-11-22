import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateEditorMediaProbes, summarizeEditorMediaProbe, validateEditorMediaProbe } from './read-editor-media-probe.mjs';

const checks = { uniqueFrames: true, timestamps: true, colors: true, audioVideoSkew: true, codecs: true, duration: true, cancelledClean: true,
    corruptClean: true, retryPassed: true, released: true, rotatedSource: true };
const evidence = (run, index, total = 80_000) => {
    const timingsMs = { renderReadback: 20_000, fileWrite: 15_000, nativeAppendEncode: total - 37_000, finalize: 2_000, total,
        audioFixture: 1_000, verification: 2_000 };
    const bytes = { written: 3_317_760_000, read: 3_317_760_000, peakBatchDisk: 29_491_200, output: 12_000_000 };
    return { schemaVersion: 1, status: 'passed', run, startedAt: `2026-11-22T00:00:${String(index).padStart(2, '0')}.000Z`,
        completedAt: `2026-11-22T00:02:${String(index).padStart(2, '0')}.000Z`, method: 'fresh process, unique content, no pre-read',
        reportUri: `file:///cache/report-${index}.json`, archiveUri: `file:///cache/archive-${index}.json`, timingsMs, bytes, checks: { ...checks }, blockers: [],
        architectureReport: { version: 1, run, ingress: 'skia-rgba8-file-batches', firstProcessMethod: 'fresh process, unique content, no pre-read',
            frameCount: 900, width: 1280, height: 720, fps: 30, timingsMs: { renderReadback: timingsMs.renderReadback, fileWrite: timingsMs.fileWrite,
                nativeAppendEncode: timingsMs.nativeAppendEncode, finalize: timingsMs.finalize, total }, bytes,
            verification: { videoCodec: 'avc1', audioCodec: 'mp4a', durationUs: 30_000_000, audioVideoSkewUs: 0, timestampToleranceUs: 1,
                colorTolerance: 12, cancelledClean: true, corruptClean: true, retryPassed: true, released: true } } };
};
test('requires three eligible first-process and three eligible warm reports', () => {
    const six = [evidence('first-process', 1, 80_000), evidence('first-process', 2, 90_000), evidence('first-process', 3, 100_000),
        evidence('warm', 4, 60_000), evidence('warm', 5, 61_000), evidence('warm', 6, 62_000)];
    assert.equal(aggregateEditorMediaProbes(six).architectureEligible, true);
    assert.equal(aggregateEditorMediaProbes(six.slice(0, 5)).architectureEligible, false);
    assert.equal(aggregateEditorMediaProbes(six.slice(0, 3)).architectureEligible, false);
});
test('rejects schema drift and cross-layer timing drift', () => {
    const valid = evidence('first-process', 1); assert.equal(summarizeEditorMediaProbe(valid).runEligible, true);
    assert.throws(() => validateEditorMediaProbe({ ...valid, invented: true }), /invalid-editor-media-probe-report/);
    assert.throws(() => validateEditorMediaProbe({ ...valid, checks: { ...valid.checks, invented: true } }), /invalid-editor-media-probe-report/);
    assert.throws(() => validateEditorMediaProbe({ ...valid, architectureReport: { ...valid.architectureReport,
        timingsMs: { ...valid.architectureReport.timingsMs, total: 79_999 } } }), /invalid-editor-media-probe-report/);
    assert.throws(() => validateEditorMediaProbe({ ...valid, bytes: { ...valid.bytes, peakBatchDisk: 40_000_000 } }), /invalid-editor-media-probe-report/);
});
