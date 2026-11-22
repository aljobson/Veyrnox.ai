import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseProbeReport, probePassesArchitectureGate, type EditorMediaProbeReport } from '../src/lib/editorMedia/protocol';

function sourceFiles(root: string): string[] {
    return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
        const path = resolve(root, entry.name);
        return entry.isDirectory() ? sourceFiles(path) : /\.[jt]sx?$/.test(entry.name) ? [path] : [];
    });
}

const report = (total: number, run: 'first-process' | 'warm' = 'first-process'): EditorMediaProbeReport => ({
    version: 1, run, ingress: 'skia-rgba8-file-batches', firstProcessMethod: 'fresh app process, unique frame content and filenames, no pre-read',
    frameCount: 900, width: 1280, height: 720, fps: 30,
    timingsMs: { renderReadback: 20_000, fileWrite: 15_000, nativeAppendEncode: total - 37_000, finalize: 2_000, total },
    bytes: { written: 3_317_760_000, read: 3_317_760_000, peakBatchDisk: 29_491_200, output: 12_000_000 }, peakRssBytes: 250_000_000,
    verification: { videoCodec: 'avc1', audioCodec: 'mp4a', durationUs: 30_000_000, audioVideoSkewUs: 1000, timestampToleranceUs: 1, colorTolerance: 12,
        cancelledClean: true, corruptClean: true, retryPassed: true, released: true },
});

test('probe report proves the exact public ingress without claiming an OS-cold cache', () => {
    expect(parseProbeReport(report(80_000))).toEqual(report(80_000));
    expect(parseProbeReport({ ...report(80_000), ingress: 'native-color-bars' })).toBeNull();
    expect(parseProbeReport({ ...report(80_000), bytes: { ...report(80_000).bytes, peakBatchDisk: 40_000_000 } })).toBeNull();
    expect(parseProbeReport({ ...report(80_000), verification: { ...report(80_000).verification, colorTolerance: 255 } })).toBeNull();
});

test('architecture gate needs three bounded first-process runs and ignores warm diagnostics', () => {
    expect(probePassesArchitectureGate([report(80_000), report(90_000), report(100_000), report(200_000, 'warm')])).toBe(true);
    expect(probePassesArchitectureGate([report(80_000), report(91_000), report(100_000)])).toBe(false);
    expect(probePassesArchitectureGate([report(80_000), report(90_000)])).toBe(false);
    expect(probePassesArchitectureGate([report(80_000), report(90_000), report(121_000)])).toBe(false);
});

test('probe flag is absent from production profiles and production routes cannot import the probe harness', () => {
    const eas = readFileSync(resolve(__dirname, '../eas.json'), 'utf8');
    expect(eas).not.toContain('EXPO_PUBLIC_DEV_S9_MEDIA_PROBE');
    const routeRoot = resolve(__dirname, '../src/app');
    const routeLeaks = sourceFiles(routeRoot).flatMap(file => {
        const source = readFileSync(file, 'utf8');
        return /EditorMediaProbeHarness|editorMedia\/probe/.test(source) ? [file] : [];
    });
    expect(routeLeaks).toEqual([]);

    const editorRoot = resolve(__dirname, '../src/components/editor');
    const unexpected = sourceFiles(editorRoot).flatMap(file => {
        if (file.endsWith('/useFullEditorSession.ts')) return [];
        const source = readFileSync(file, 'utf8');
        return /(?:from\s+|require\()['"][^'"]*\/editorMedia(?:\/probe)?['"]/.test(source) ? [file] : [];
    });
    expect(unexpected).toEqual([]);
});
