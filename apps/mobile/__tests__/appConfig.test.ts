import appJson from '../app.json';

// Store-review facts that live in app.json (ADR-0127). A change here should be deliberate.
const expo = appJson.expo;
const manifest = expo.ios.privacyManifests;

describe('iOS privacy manifest', () => {
    test('declares no tracking', () => {
        expect(manifest.NSPrivacyTracking).toBe(false);
        expect(manifest.NSPrivacyTrackingDomains).toEqual([]);
        for (const t of manifest.NSPrivacyCollectedDataTypes) expect(t.NSPrivacyCollectedDataTypeTracking).toBe(false);
    });

    test('lists the four required-reason categories Expo and React Native use, each with a reason', () => {
        const byType = Object.fromEntries(manifest.NSPrivacyAccessedAPITypes.map((a) => [a.NSPrivacyAccessedAPIType, a.NSPrivacyAccessedAPITypeReasons]));
        expect(Object.keys(byType).sort()).toEqual([
            'NSPrivacyAccessedAPICategoryDiskSpace',
            'NSPrivacyAccessedAPICategoryFileTimestamp',
            'NSPrivacyAccessedAPICategorySystemBootTime',
            'NSPrivacyAccessedAPICategoryUserDefaults',
        ]);
        for (const reasons of Object.values(byType)) expect(reasons.length).toBeGreaterThan(0);
    });

    test('collected data matches the store checklist: account, content and purchases linked, crash data not', () => {
        const linked = Object.fromEntries(manifest.NSPrivacyCollectedDataTypes.map((t) => [t.NSPrivacyCollectedDataType, t.NSPrivacyCollectedDataTypeLinked]));
        expect(linked).toEqual({
            NSPrivacyCollectedDataTypeEmailAddress: true,
            NSPrivacyCollectedDataTypeUserID: true,
            NSPrivacyCollectedDataTypeDeviceID: true,
            NSPrivacyCollectedDataTypePurchaseHistory: true,
            NSPrivacyCollectedDataTypeOtherUserContent: true,
            NSPrivacyCollectedDataTypePhotosorVideos: true,
            NSPrivacyCollectedDataTypeAudioData: true,
            NSPrivacyCollectedDataTypeCrashData: false,
        });
    });
});

describe('permissions', () => {
    const plugin = (name: string) => (expo.plugins as unknown[]).find((p) => p === name || (Array.isArray(p) && p[0] === name));

    test('Publish camera and photo wording is explicit; microphone and Face ID remain off', () => {
        expect(plugin('expo-image-picker')).toEqual(['expo-image-picker', { cameraPermission: 'Veyrnox.ai uses the camera when you take a photo to post with Publish.', photosPermission: 'Veyrnox.ai reads the photo or video you choose, to use as a starting point for a creation or to post with Publish.', microphonePermission: false }]);
        expect(plugin('expo-secure-store')).toEqual(['expo-secure-store', { faceIDPermission: false }]);
    });

    test('no other usage strings are set by hand', () => {
        expect(Object.keys(expo.ios.infoPlist)).toEqual(['ITSAppUsesNonExemptEncryption']);
    });
});
