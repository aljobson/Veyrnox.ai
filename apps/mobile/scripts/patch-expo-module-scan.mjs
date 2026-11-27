import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The app has enough Expo Swift modules that the autolinking scanner can take
// longer than its upstream five-second default on a busy local/CI builder. A
// timeout drops core modules from ExpoModulesProvider and fails the final app
// compile. Keep the scanner bounded, but give it a realistic window.
const files = [
    ['../node_modules/expo-modules-autolinking/src/platforms/apple/moduleScanner.ts', 'timeout: 5000', 'timeout: 30000'],
    ['../node_modules/expo-modules-autolinking/build/platforms/apple/moduleScanner.js', 'timeout: 5000', 'timeout: 30000'],
];

for (const [relativePath, original, replacement] of files) {
    const path = fileURLToPath(new URL(relativePath, import.meta.url));
    const source = readFileSync(path, 'utf8');
    if (source.includes(replacement)) continue;
    if (!source.includes(original)) {
        throw new Error(`expo module scanner source changed; review timeout patch: ${relativePath}`);
    }
    writeFileSync(path, source.replace(original, replacement));
}
