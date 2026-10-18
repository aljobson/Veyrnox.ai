// Universal Links (iOS) and App Links (Android) for the mobile app (ADR-0106).
// Non-secret and public, but the repo cannot know them: the owner edits the two
// values below via PR. While either is empty the matching file answers 404, so
// a half-configured association is never published.

export const APP_ID = 'ai.veyrnox.app'; // iOS bundle id and Android package

// Apple Developer Team ID (Veyrnox LTD; public, it appears in the served file).
export const APPLE_TEAM_ID = 'R54268MWFV';

// SHA-256 fingerprints of the Android signing certificates, "AA:BB:..." form
// (Play Console > App integrity > App signing key certificate, plus the upload
// key if testing a side-loaded build).
export const ANDROID_SHA256_FINGERPRINTS = [];

// Web paths the app can open. Only screens that exist in apps/mobile/src/app;
// add Cinema title/watch paths when M9 lands.
export const APP_LINK_PATHS = [
    '/app/library',
    '/app/library/*',
    '/app/chat',
    '/app/chat/*',
    '/app/create',
    '/app/create/*',
    '/app/credits',
    '/app/account',
    '/app/publish',
];

const TEAM_ID_RE = /^[A-Z0-9]{10}$/;
const FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function appleAppSiteAssociation(teamId = APPLE_TEAM_ID, paths = APP_LINK_PATHS) {
    if (!TEAM_ID_RE.test(teamId)) return null;
    return {
        applinks: {
            details: [{
                appIDs: [`${teamId}.${APP_ID}`],
                components: paths.map((path) => ({ '/': path })),
            }],
        },
    };
}

export function androidAssetLinks(fingerprints = ANDROID_SHA256_FINGERPRINTS) {
    if (!fingerprints.length || !fingerprints.every((f) => FINGERPRINT_RE.test(f))) return null;
    return [{
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
            namespace: 'android_app',
            package_name: APP_ID,
            sha256_cert_fingerprints: fingerprints,
        },
    }];
}

export function associationResponse(body) {
    if (!body) {
        return new Response(JSON.stringify({ error: 'not_configured' }), {
            status: 404,
            headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        });
    }
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
    });
}
