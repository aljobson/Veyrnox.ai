import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
    MICROPHONE_USAGE,
    PHONE_ORIENTATIONS,
    SPEECH_USAGE,
    generatedFieldsMatch,
    readInfoPlist,
    syncGeneratedIosPlist,
} from './sync-generated-ios-plist.mjs';

const fixture = {
    CFBundleDisplayName: 'Veyrnox.ai',
    CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
    CFBundleURLTypes: [{ CFBundleURLSchemes: ['ai.veyrnox.app'] }],
    UISupportedInterfaceOrientations: ['UIInterfaceOrientationPortrait'],
};

function sandbox(value = fixture) {
    const root = mkdtempSync(join(tmpdir(), 'veyrnox-generated-plist-'));
    const directory = join(root, 'ios', 'Veyrnoxai');
    mkdirSync(directory, { recursive: true });
    const file = join(directory, 'Info.plist');
    writeFileSync(file, JSON.stringify(value));
    return { root, file, clean: () => rmSync(root, { recursive: true, force: true }) };
}

test('sync writes the declared phone orientation and privacy descriptions, then becomes idempotent', () => {
    const s = sandbox();
    try {
        assert.deepEqual(syncGeneratedIosPlist({ mobileRoot: s.root }), { changed: true, file: s.file });
        const first = readFileSync(s.file);
        const value = readInfoPlist(s.file);
        assert.deepEqual(value.UISupportedInterfaceOrientations, PHONE_ORIENTATIONS);
        assert.equal(value.NSSpeechRecognitionUsageDescription, SPEECH_USAGE);
        assert.equal(value.NSMicrophoneUsageDescription, MICROPHONE_USAGE);
        assert.equal(generatedFieldsMatch(value), true);
        assert.deepEqual(syncGeneratedIosPlist({ mobileRoot: s.root }), { changed: false, file: s.file });
        assert.deepEqual(readFileSync(s.file), first);
        assert.deepEqual(syncGeneratedIosPlist({ mobileRoot: s.root, check: true }), { changed: false, file: s.file });
    } finally { s.clean(); }
});

test('local generated settings stay aligned with source app config and the Vision plugin', () => {
    const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
    const plugin = readFileSync(new URL('../modules/veyrnox-vision/app.plugin.js', import.meta.url), 'utf8');
    assert.equal(app.expo.orientation, 'portrait');
    assert.match(plugin, new RegExp(SPEECH_USAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(plugin, new RegExp(MICROPHONE_USAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(plugin, /NSSpeechRecognitionUsageDescription\s*\|\|=/);
    assert.doesNotMatch(plugin, /NSMicrophoneUsageDescription\s*\|\|=/);
    const finalPlugin = app.expo.plugins.at(-1);
    assert.equal(finalPlugin[0], 'react-native-audio-api');
    assert.equal(finalPlugin[1].iosMicrophonePermission, MICROPHONE_USAGE);
    const audio = app.expo.ios.privacyManifests.NSPrivacyCollectedDataTypes.find(value => value.NSPrivacyCollectedDataType === 'NSPrivacyCollectedDataTypeAudioData');
    assert.deepEqual(audio, {
        NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeAudioData', NSPrivacyCollectedDataTypeLinked: true,
        NSPrivacyCollectedDataTypeTracking: false, NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
    });
});

test('check mode refuses stale state without changing it', () => {
    const s = sandbox();
    try {
        const before = readFileSync(s.file);
        assert.throws(() => syncGeneratedIosPlist({ mobileRoot: s.root, check: true }), /stale/);
        assert.deepEqual(readFileSync(s.file), before);
    } finally { s.clean(); }
});

test('refuses a missing, redirected or unexpected application plist', () => {
    const missing = mkdtempSync(join(tmpdir(), 'veyrnox-generated-plist-missing-'));
    try { assert.throws(() => syncGeneratedIosPlist({ mobileRoot: missing }), /missing/); }
    finally { rmSync(missing, { recursive: true, force: true }); }

    const unexpected = sandbox({ ...fixture, CFBundleDisplayName: 'Another app' });
    try { assert.throws(() => syncGeneratedIosPlist({ mobileRoot: unexpected.root }), /unexpected generated/); }
    finally { unexpected.clean(); }

    const redirectedRoot = mkdtempSync(join(tmpdir(), 'veyrnox-generated-plist-link-'));
    const source = sandbox();
    try {
        mkdirSync(join(redirectedRoot, 'ios', 'Veyrnoxai'), { recursive: true });
        symlinkSync(source.file, join(redirectedRoot, 'ios', 'Veyrnoxai', 'Info.plist'));
        assert.throws(() => syncGeneratedIosPlist({ mobileRoot: redirectedRoot }), /regular file|redirected/);
    } finally { source.clean(); rmSync(redirectedRoot, { recursive: true, force: true }); }
});
