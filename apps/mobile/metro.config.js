const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// The repo root holds the Next.js app's own node_modules (a different React).
// Prefer this app's copy so the bundle never picks up the web copy.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];

module.exports = config;
