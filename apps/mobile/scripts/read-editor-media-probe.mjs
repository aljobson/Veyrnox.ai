#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const CHECK_NAMES = ['uniqueFrames', 'timestamps', 'colors', 'audioVideoSkew', 'codecs', 'duration', 'cancelledClean', 'corruptClean', 'retryPassed', 'released', 'rotatedSource'];
const TIMING_NAMES = ['renderReadback', 'fileWrite', 'nativeAppendEncode', 'finalize', 'total'];
const EVIDENCE_TIMING_NAMES = [...TIMING_NAMES, 'audioFixture', 'verification'];
const BYTE_NAMES = ['written', 'read', 'peakBatchDisk', 'output'];
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const integer = value => Number.isSafeInteger(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => key in value);
const schemaKeys = (value, required, optional = []) => object(value) && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
    && required.every(key => key in value);
const stableText = value => typeof value === 'string' && /^[a-z0-9-]{1,100}$/.test(value);
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validFileUri = value => typeof value === 'string' && /^file:\/\/\/[A-Za-z0-9%._~!$&'()*+,;=:@/-]{1,4096}$/.test(value)
    && !/%(?:2e|2f|5c)/i.test(value) && !/\/(?:\.{1,2})(?:\/|$)/.test(value);
const fail = () => { throw new Error('invalid-editor-media-probe-report'); };

function validateBytes(value, allowZero = false) {
    if (!exactKeys(value, BYTE_NAMES) || !BYTE_NAMES.every(key => integer(value[key]) && value[key] >= (allowZero ? 0 : 1))
        || value.peakBatchDisk > 32 * 1024 * 1024 || value.output > 25 * 1024 * 1024) fail();
}
export function validateArchitectureReport(value) {
    if (!schemaKeys(value, ['version', 'run', 'ingress', 'firstProcessMethod', 'frameCount', 'width', 'height', 'fps', 'timingsMs', 'bytes', 'verification'], ['peakRssBytes'])
        || value.version !== 1 || !['first-process', 'warm'].includes(value.run) || value.ingress !== 'skia-rgba8-file-batches'
        || typeof value.firstProcessMethod !== 'string' || !value.firstProcessMethod || value.firstProcessMethod.length > 1000
        || value.frameCount !== 900 || value.width !== 1280 || value.height !== 720 || value.fps !== 30
        || !exactKeys(value.timingsMs, TIMING_NAMES) || !TIMING_NAMES.every(key => finite(value.timingsMs[key]) && value.timingsMs[key] >= 0)
        || value.peakRssBytes !== undefined && (!integer(value.peakRssBytes) || value.peakRssBytes < 1)) fail();
    validateBytes(value.bytes);
    const proof = value.verification;
    if (!exactKeys(proof, ['videoCodec', 'audioCodec', 'durationUs', 'audioVideoSkewUs', 'timestampToleranceUs', 'colorTolerance',
        'cancelledClean', 'corruptClean', 'retryPassed', 'released']) || proof.videoCodec !== 'avc1' || proof.audioCodec !== 'mp4a'
        || !integer(proof.durationUs) || Math.abs(proof.durationUs - 30_000_000) > 33_334 || !integer(proof.audioVideoSkewUs)
        || Math.abs(proof.audioVideoSkewUs) > 33_334 || proof.timestampToleranceUs !== 1 || proof.colorTolerance !== 12
        || !['cancelledClean', 'corruptClean', 'retryPassed', 'released'].every(key => proof[key] === true)) fail();
    return value;
}
export function validateEditorMediaProbe(value) {
    if (!schemaKeys(value, ['schemaVersion', 'status', 'run', 'startedAt', 'completedAt', 'method', 'architectureReport', 'timingsMs', 'bytes', 'checks', 'blockers'],
        ['reportUri', 'archiveUri', 'failure']) || value.schemaVersion !== 1 || !['passed', 'blocked', 'failed'].includes(value.status)
        || !['first-process', 'warm'].includes(value.run) || !validDate(value.startedAt) || !validDate(value.completedAt)
        || Date.parse(value.completedAt) < Date.parse(value.startedAt) || typeof value.method !== 'string' || !value.method || value.method.length > 1000
        || value.reportUri !== undefined && !validFileUri(value.reportUri) || value.archiveUri !== undefined && !validFileUri(value.archiveUri)
        || !exactKeys(value.timingsMs, EVIDENCE_TIMING_NAMES) || !EVIDENCE_TIMING_NAMES.every(key => finite(value.timingsMs[key]) && value.timingsMs[key] >= 0)) fail();
    validateBytes(value.bytes, value.status !== 'passed');
    if (!exactKeys(value.checks, CHECK_NAMES) || !CHECK_NAMES.every(key => value.checks[key] === null || typeof value.checks[key] === 'boolean')
        || !Array.isArray(value.blockers) || !value.blockers.every(stableText) || new Set(value.blockers).size !== value.blockers.length
        || value.failure !== undefined && !stableText(value.failure)) fail();
    if (value.status === 'passed') {
        const report = validateArchitectureReport(value.architectureReport);
        if (report.run !== value.run || !CHECK_NAMES.every(key => value.checks[key] === true) || value.blockers.length || value.failure !== undefined
            || !TIMING_NAMES.every(key => report.timingsMs[key] === value.timingsMs[key]) || !BYTE_NAMES.every(key => report.bytes[key] === value.bytes[key])) fail();
    } else if (value.architectureReport !== null || value.status === 'failed' !== stableText(value.failure)
        || value.status === 'blocked' && CHECK_NAMES.every(key => value.checks[key] === true) && !value.blockers.length) fail();
    return value;
}
export function summarizeEditorMediaProbe(value) {
    value = validateEditorMediaProbe(value);
    const failedChecks = CHECK_NAMES.filter(name => value.checks[name] !== true);
    return { status: value.status, run: value.run, runEligible: value.status === 'passed', totalMs: value.timingsMs.total,
        outputBytes: value.bytes.output, failedChecks, blockers: value.blockers, failure: value.failure ?? null };
}
export async function readEditorMediaProbe(path) {
    const value = validateEditorMediaProbe(JSON.parse(await readFile(path, 'utf8'))); return { value, summary: summarizeEditorMediaProbe(value) };
}
const median = values => values.length % 2 ? values[Math.floor(values.length / 2)] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
export function aggregateEditorMediaProbes(values) {
    const reports = values.map(validateEditorMediaProbe), summaries = reports.map(summarizeEditorMediaProbe);
    const first = reports.filter(value => value.run === 'first-process'), warm = reports.filter(value => value.run === 'warm');
    const totals = first.map(value => value.timingsMs.total).sort((a, b) => a - b), uniqueRuns = new Set(reports.map(value => value.startedAt)).size === reports.length;
    const architectureEligible = summaries.every(summary => summary.runEligible) && first.length >= 3 && warm.length >= 3 && uniqueRuns
        && median(totals) <= 90_000 && totals.every(total => total <= 120_000);
    return { architectureEligible, firstProcessRuns: first.length, warmRuns: warm.length, uniqueRuns,
        firstProcessMedianMs: totals.length ? median(totals) : null, firstProcessMaxMs: totals.length ? totals[totals.length - 1] : null, runs: summaries };
}
async function main() {
    const paths = process.argv.slice(2); if (!paths.length) { console.error('Usage: read-editor-media-probe.mjs REPORT.json [REPORT.json ...]'); process.exitCode = 2; return; }
    try { const reports = await Promise.all(paths.map(readEditorMediaProbe)), summary = aggregateEditorMediaProbes(reports.map(report => report.value));
        console.log(JSON.stringify(summary, null, 2)); if (!summary.architectureEligible) process.exitCode = 1; }
    catch (error) { console.error(error instanceof Error ? error.message : 'invalid-editor-media-probe-report'); process.exitCode = 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
