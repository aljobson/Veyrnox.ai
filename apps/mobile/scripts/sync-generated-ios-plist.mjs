#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PHONE_ORIENTATIONS = Object.freeze([
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
]);
export const SPEECH_USAGE = 'Veyrnox creates editable captions from audio on this device.';
export const MICROPHONE_USAGE = 'Veyrnox uses the microphone only when you choose to record a voiceover, a beat take, or audio for editable captions.';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const MOBILE_ROOT = resolve(SCRIPT_DIR, '..');
export const GENERATED_INFO_PLIST = join(MOBILE_ROOT, 'ios', 'Veyrnoxai', 'Info.plist');

function runPlutil(args, input) {
    const result = spawnSync('plutil', args, { encoding: 'utf8', ...(input === undefined ? {} : { input }) });
    if (result.status !== 0) throw new Error(`plutil ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
    return result.stdout;
}

function generatedPath(mobileRoot) {
    return join(resolve(mobileRoot), 'ios', 'Veyrnoxai', 'Info.plist');
}

function assertGeneratedTarget(mobileRoot, file) {
    const expected = generatedPath(mobileRoot);
    if (resolve(file) !== expected) throw new Error(`refusing unexpected plist path: ${file}`);
    if (!existsSync(file)) throw new Error(`generated iOS Info.plist is missing: ${file}`);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`generated iOS Info.plist must be a regular file: ${file}`);
    const expectedReal = join(realpathSync(mobileRoot), 'ios', 'Veyrnoxai', 'Info.plist');
    if (realpathSync(file) !== expectedReal) throw new Error(`refusing redirected plist path: ${file}`);
}

export function readInfoPlist(file) {
    return JSON.parse(runPlutil(['-convert', 'json', '-o', '-', file]));
}

export function assertVeyrnoxInfoPlist(value) {
    const schemes = value?.CFBundleURLTypes?.flatMap(item => item?.CFBundleURLSchemes ?? []) ?? [];
    if (value?.CFBundleDisplayName !== 'Veyrnox.ai'
        || value?.CFBundleIdentifier !== '$(PRODUCT_BUNDLE_IDENTIFIER)'
        || !schemes.includes('ai.veyrnox.app')) {
        throw new Error('refusing unexpected generated iOS application plist');
    }
}

export function expectedGeneratedFields(value) {
    return {
        ...value,
        UISupportedInterfaceOrientations: [...PHONE_ORIENTATIONS],
        NSSpeechRecognitionUsageDescription: SPEECH_USAGE,
        NSMicrophoneUsageDescription: MICROPHONE_USAGE,
    };
}

export function generatedFieldsMatch(value) {
    return JSON.stringify(value?.UISupportedInterfaceOrientations) === JSON.stringify(PHONE_ORIENTATIONS)
        && value?.NSSpeechRecognitionUsageDescription === SPEECH_USAGE
        && value?.NSMicrophoneUsageDescription === MICROPHONE_USAGE;
}

function writeAtomicPlist(file, value) {
    const scratch = mkdtempSync(join(dirname(file), '.veyrnox-plist-'));
    const temporary = join(scratch, 'Info.plist');
    try {
        writeFileSync(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: lstatSync(file).mode & 0o777 });
        runPlutil(['-convert', 'xml1', temporary]);
        runPlutil(['-lint', temporary]);
        renameSync(temporary, file);
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

export function syncGeneratedIosPlist({ mobileRoot = MOBILE_ROOT, check = false } = {}) {
    const file = generatedPath(mobileRoot);
    assertGeneratedTarget(mobileRoot, file);
    const current = readInfoPlist(file);
    assertVeyrnoxInfoPlist(current);
    const matches = generatedFieldsMatch(current);
    if (check) {
        if (!matches) throw new Error('generated iOS Info.plist is stale; run npm run ios:sync-generated-config');
        return { changed: false, file };
    }
    if (!matches) writeAtomicPlist(file, expectedGeneratedFields(current));
    const verified = readInfoPlist(file);
    assertVeyrnoxInfoPlist(verified);
    if (!generatedFieldsMatch(verified)) throw new Error('generated iOS Info.plist verification failed');
    return { changed: !matches, file };
}

function main(args) {
    if (args.some(value => value !== '--check') || args.length > 1) throw new Error('Usage: sync-generated-ios-plist.mjs [--check]');
    const result = syncGeneratedIosPlist({ check: args[0] === '--check' });
    console.log(`${result.changed ? 'Updated' : 'OK'}: ${result.file}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try { main(process.argv.slice(2)); }
    catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}
