const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

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
config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (nativeRelease && !context.dev && (platform === 'ios' || platform === 'android') && moduleName === '@revenuecat/purchases-js-hybrid-mappings') {
        return { type: 'sourceFile', filePath: path.resolve(__dirname, 'src/lib/purchasesNativeOnly.js') };
    }
    return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
