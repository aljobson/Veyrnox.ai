import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// react-native-passkeys 0.4.2 sends both a platform-passkey request and a
// security-key request to AuthenticationServices. On iOS that exposes the
// cross-device QR flow even though this app's sign-in is specifically for the
// passkey already stored by an enabled credential provider (iCloud Keychain,
// Google Password Manager, 1Password, and similar providers).
//
// Keep this narrow and fail closed when the upstream source changes so an
// upgrade cannot silently bring the QR flow back.
const modulePath = fileURLToPath(new URL(
    '../node_modules/react-native-passkeys/ios/ReactNativePasskeysModule.swift',
    import.meta.url,
));
const crossPlatformRequest = `            let crossPlatformKeyAssertionRequest = prepareCrossPlatformAssertionRequest(
                challenge: challengeData, request: request)
`;
const original = `            let authController = ASAuthorizationController(authorizationRequests: [
                platformKeyAssertionRequest, crossPlatformKeyAssertionRequest,
            ])`;
const replacement = `            // Veyrnox sign-in uses credentials available through the device's enabled
            // passkey providers. Do not add a security-key request: that request makes
            // AuthenticationServices offer the cross-device QR scanner before it reports
            // that no matching Veyrnox passkey is stored locally.
            let authController = ASAuthorizationController(authorizationRequests: [
                platformKeyAssertionRequest,
            ])`;

let source = readFileSync(modulePath, 'utf8');
if (source.includes(replacement) && !source.includes(crossPlatformRequest)) process.exit(0);
if (!source.includes(original)) {
    // An earlier run may already have replaced the controller. It is safe to
    // finish by removing only the now-unused request from the same get flow.
    if (!source.includes(replacement) || !source.includes(crossPlatformRequest)) {
        throw new Error('react-native-passkeys iOS authentication source changed; review the platform-only patch');
    }
} else {
    source = source.replace(original, replacement);
}
source = source.replace(crossPlatformRequest, '');
writeFileSync(modulePath, source);
