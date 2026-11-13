// Run from any directory before Expo bundles. No binaries are committed.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('../../../', import.meta.url), output = new URL('../assets/live-edit/', import.meta.url);
// EAS must upload the monorepo root and install its pinned MediaPipe assets as well as mobile devDependencies.
for (const file of ['scripts/editor-vision-assets.mjs', 'app/veyrnox/_lib/editorVisionRuntime.mjs',
    'scripts/editor-vision-notices/NOTICE.txt', 'scripts/editor-vision-notices/FACE-NOTICE.txt',
    'scripts/editor-vision-notices/Apache-2.0.txt', 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs',
    'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js',
    'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm']) {
    try { await access(new URL(file, root)); }
    catch { throw Error(`Live Edit preparation requires the full monorepo and root dependencies; missing ${file}. Run EAS from apps/mobile with the repository root included.`); }
}
let transform;
try { ({ transform } = await import('esbuild')); }
catch { throw Error('Live Edit preparation requires mobile devDependency esbuild@0.28.2. Install apps/mobile dependencies including devDependencies before bundling.'); }
const { VISION_ASSETS, FACE_ASSETS } = await import('../../../scripts/editor-vision-assets.mjs');
const required = [...VISION_ASSETS.filter(a => !['worker.mjs', 'NOTICE.txt', 'Apache-2.0.txt'].includes(a.path)), FACE_ASSETS[0]];
const values = {};
for (const item of required) {
    let bytes;
    if (item.source.startsWith('https:')) {
        // Reuse the already-prepared web model when present, still verifying every byte.
        const { EDITOR_VISION_VERSION, FACE_VISION_VERSION } = await import('../../../app/veyrnox/_lib/editorVisionRuntime.mjs');
        const version = item.path.endsWith('.task') ? FACE_VISION_VERSION : EDITOR_VISION_VERSION;
        try { bytes = await readFile(new URL(`public/editor-vision/${version}/${item.path}`, root)); }
        catch {
            const response = await fetch(item.source, { signal: AbortSignal.timeout(120000) });
            if (!response.ok) throw Error(`Model download failed: ${item.path}`);
            bytes = Buffer.from(await response.arrayBuffer());
        }
    } else bytes = await readFile(new URL(item.source, root));
    if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw Error(`Pin mismatch: ${item.path}`);
    values[item.path] = bytes;
}
const bundle = (await transform(values['vision_bundle.mjs'].toString(), { format: 'iife', globalName: 'Vision', target: 'es2020', minify: true })).code;
const assets = {
    loader: `data:text/javascript;base64,${values['wasm/vision_wasm_module_internal.js'].toString('base64')}`,
    wasm: `data:application/wasm;base64,${values['wasm/vision_wasm_module_internal.wasm'].toString('base64')}`,
    face: values['face_landmarker.task'].toString('base64'), hair: values['selfie_multiclass_256x256.tflite'].toString('base64'),
};
const notices = await Promise.all(['NOTICE.txt', 'FACE-NOTICE.txt', 'Apache-2.0.txt'].map(name => readFile(new URL(`scripts/editor-vision-notices/${name}`, root), 'utf8')));
const runtime = await readFile(new URL('./live-edit-webview.js', import.meta.url), 'utf8');
// data: WASM fetches work from an opaque/file origin; no file:// fetch or HTTP origin needed.
// Only this isolated hidden document permits WASM. No website CSP is changed.
const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' data:; connect-src data:; img-src data:; style-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'"><script type="application/json" id="licenses">${JSON.stringify(notices).replaceAll('<', '\\u003c')}</script><script>${bundle.replaceAll('</script', '<\\/script')}\nconst LIVE_ASSETS=${JSON.stringify(assets)};\n${runtime}</script>`;
await mkdir(output, { recursive: true });
await writeFile(new URL('runtime.html', output), html);
for (const [target, source] of [['NOTICE.txt', 'NOTICE.txt'], ['FACE-NOTICE.txt', 'FACE-NOTICE.txt'], ['Apache-2.0.txt', 'Apache-2.0.txt']]) {
    await writeFile(new URL(target, output), await readFile(new URL(`scripts/editor-vision-notices/${source}`, root)));
}
await writeFile(new URL('manifest.json', output), JSON.stringify({ assets: required, inventorySha256: createHash('sha256').update(await readFile(new URL('scripts/editor-vision-assets.mjs', root))).digest('hex'), runnerSha256: createHash('sha256').update(runtime).digest('hex'), prepareSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'), htmlBytes: Buffer.byteLength(html), htmlSha256: createHash('sha256').update(html).digest('hex') }, null, 2));
console.log(`Prepared offline mobile vision: ${Buffer.byteLength(html)} bytes HTML; all ${required.length} pinned inputs verified.`);
