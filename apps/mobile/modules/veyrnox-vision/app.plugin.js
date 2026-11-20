const { withDangerousMod, withAppBuildGradle } = require('expo/config-plugins');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');

const matchesInventory = (bytes, asset) => bytes.length === asset.bytes && createHash('sha256').update(bytes).digest('hex') === asset.sha256;

// Build-time only. A prepared local model is preferred; every source is checked against the shared inventory.
async function copyModels(projectRoot, platform) {
    const root = resolve(projectRoot, '../..');
    const { FACE_ASSETS, VISION_ASSETS } = await import(pathToFileURL(join(root, 'scripts/editor-vision-assets.mjs')).href);
    const { FACE_VISION_VERSION, EDITOR_VISION_VERSION } = await import(pathToFileURL(join(root, 'app/veyrnox/_lib/editorVisionRuntime.mjs')).href);
    const target = join(projectRoot, 'modules/veyrnox-vision', platform === 'ios' ? 'ios/Models' : 'android/src/main/assets/veyrnox-vision');
    const files = [FACE_ASSETS.find(a => a.path.endsWith('.task')), VISION_ASSETS.find(a => a.path.endsWith('.tflite'))];
    const verified = [];
    for (const asset of files) {
        let bytes;
        for (const local of [join(target, asset.path), join(root, 'public/editor-vision', asset.path.endsWith('.task') ? FACE_VISION_VERSION : EDITOR_VISION_VERSION, asset.path)]) {
            try {
                const candidate = await readFile(local);
                if (matchesInventory(candidate, asset)) { bytes = candidate; break; }
                // Ignore stale prepared/public bytes; only a verified source may replace them.
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        if (!bytes) {
            const response = await fetch(asset.source, { signal: AbortSignal.timeout(120_000) });
            if (!response.ok) throw Error('vision-model-download-failed');
            bytes = Buffer.from(await response.arrayBuffer());
        }
        if (!matchesInventory(bytes, asset)) throw Error('vision-model-hash-mismatch');
        verified.push([asset.path, bytes]);
    }
    for (const name of ['NOTICE.txt', 'FACE-NOTICE.txt', 'Apache-2.0.txt']) {
        const source = `scripts/editor-vision-notices/${name}`;
        // FACE-NOTICE.txt has path NOTICE.txt in FACE_ASSETS; match its source instead.
        const asset = [...VISION_ASSETS, ...FACE_ASSETS].find(a => a.source === source);
        if (!asset) throw Error('vision-notice-inventory-missing');
        const bytes = await readFile(join(root, source));
        if (!matchesInventory(bytes, asset)) throw Error('vision-notice-hash-mismatch');
        verified.push([name, bytes]);
    }
    // Verify every model and notice before writing any bundle resources.
    await mkdir(target, { recursive: true });
    for (const [name, bytes] of verified) await writeFile(join(target, name), bytes);
}
module.exports = function withVeyrnoxVision(config) {
    for (const platform of ['ios', 'android']) {
        config = withDangerousMod(config, [platform, async mod => { await copyModels(mod.modRequest.projectRoot, platform); return mod; }]);
    }
    // The app's final asset packaging must preserve mmap-compatible models as well as the library's AAR.
    return withAppBuildGradle(config, mod => {
        const setting = "android { androidResources { noCompress += ['tflite', 'task'] } }";
        if (!mod.modResults.contents.includes(setting)) mod.modResults.contents += `\n${setting}\n`;
        return mod;
    });
};
module.exports.copyModels = copyModels;
