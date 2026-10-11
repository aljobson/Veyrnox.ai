import { resolve } from 'node:path';
import { verifyAssets } from './local-speech-assets.mjs';
const base = resolve(process.argv[2] || 'public');
const result = await verifyAssets(base);
console.log(`Verified ${result.files} local speech assets in ${base}: ${result.bytes} bytes, largest ${result.largest} bytes.`);
