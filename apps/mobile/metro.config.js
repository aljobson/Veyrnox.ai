const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

require('./scripts/ensure-live-edit.cjs')();
const config = getDefaultConfig(__dirname);
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'html'])];

// The repo root holds the Next.js app's own node_modules (a different React).
// Prefer this app's copy so the bundle never picks up the web copy.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
// Pure shared document validation; do not expose the web app's node_modules/React.
config.watchFolders = [...new Set([...(config.watchFolders || []),
    path.resolve(__dirname, '../../app/veyrnox/_lib'), path.resolve(__dirname, '../../lib'),
])];

// Only explicitly flagged native EAS release artifacts contain RNPurchases.
// Expo Go, unflagged dev clients, web and Jest keep the real browser SDK.
const nativeRelease = process.env.VEYRNOX_NATIVE_PURCHASES === '1';
// The web mixdown lazily imports beatAssets.js for Music sources, which reaches browser auth. Native refuses those sources.
const webMixdown = path.resolve(__dirname, '../../app/veyrnox/_lib/music/beat/beatMixdown.js');
config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === './beatAssets.js' && context.originModulePath === webMixdown) {
        return { type: 'sourceFile', filePath: path.resolve(__dirname, 'src/lib/beatNative/beatAssetsUnavailable.ts') };
    }
    if (nativeRelease && !context.dev && (platform === 'ios' || platform === 'android') && moduleName === '@revenuecat/purchases-js-hybrid-mappings') {
        return { type: 'sourceFile', filePath: path.resolve(__dirname, 'src/lib/purchasesNativeOnly.js') };
    }
    return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
