import { resolve } from 'node:path';
import { verifyAssets } from './video-enhance-assets.mjs';
const base = resolve(process.argv[2] || 'public');
const count = await verifyAssets(base);
console.log(`Verified ${count} Video Enhance assets in ${base}`);
