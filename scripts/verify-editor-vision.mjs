import { resolve } from 'node:path';
import { verifyVisionAssets } from './editor-vision-assets.mjs';
const base = resolve(process.argv[2] || 'public');
const result = await verifyVisionAssets(base);
console.log(`Verified current hair/face and one previous segmentation prefix: ${result.files} local vision assets in ${base}: ${result.bytes} bytes, largest ${result.largest} bytes.`);
