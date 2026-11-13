// Run from any directory before Expo bundles. No binaries are committed.
import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('../../../', import.meta.url), output = new URL('../assets/live-edit/', import.meta.url);
// EAS must upload the monorepo root and install its pinned MediaPipe assets as well as mobile devDependencies.
for (const file of ['scripts/editor-vision-assets.mjs', 'app/veyrnox/_lib/editorVisionRuntime.mjs',
    'scripts/editor-vision-notices/NOTICE.txt', 'scripts/editor-vision-notices/FACE-NOTICE.txt',
    'scripts/editor-vision-notices/Apache-2.0.txt', 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs',
    'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js',
    'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm',
    // Live camera (ADR-0335 S8/S9): the web engine, three.js for 3D wigs, and the wig art are inlined into the same document.
    'app/veyrnox/_lib/liveEdit/liveEngine.js', 'packages/live-edit/wig3d.js', 'node_modules/three/build/three.module.js', 'node_modules/three/build/three.core.js', 'node_modules/three/LICENSE']) {
    try { await access(new URL(file, root)); }
    catch { throw Error(`Live Edit preparation requires the full monorepo and root dependencies; missing ${file}. Run EAS from apps/mobile with the repository root included.`); }
}
let transform, build;
try { ({ transform, build } = await import('esbuild')); }
catch { throw Error('Live Edit preparation requires mobile devDependency esbuild@0.28.2. Install apps/mobile dependencies including devDependencies before bundling.'); }
const { VISION_ASSETS, FACE_ASSETS } = await import('../../../scripts/editor-vision-assets.mjs');
// A page loads MediaPipe's WASM through a classic <script>; the web Worker's `module` variant uses import.meta and cannot
// run there ("ModuleFactory not set"). The classic variant is pinned here, not added to the shared web asset inventory.
const CLASSIC_WASM = [
    { path: 'wasm/vision_wasm_internal.js', source: 'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js', bytes: 323377, sha256: 'e170ee67dd4e16c1a6fcd8840a206687e5a59b22c20e4a902bc445b095454d73' },
    { path: 'wasm/vision_wasm_internal.wasm', source: 'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm', bytes: 11756954, sha256: '8da277a733926eacd0474b8704b36742d6ec3231c57a860c5b889dff8f1df886' },
];
const required = [...VISION_ASSETS.filter(a => !['worker.mjs', 'NOTICE.txt', 'Apache-2.0.txt'].includes(a.path) && !a.path.startsWith('wasm/')), ...CLASSIC_WASM, FACE_ASSETS[0]];
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
    loader: `data:text/javascript;base64,${values['wasm/vision_wasm_internal.js'].toString('base64')}`,
    wasm: `data:application/wasm;base64,${values['wasm/vision_wasm_internal.wasm'].toString('base64')}`,
    face: values['face_landmarker.task'].toString('base64'), hair: values['selfie_multiclass_256x256.tflite'].toString('base64'),
};
const notices = await Promise.all(['NOTICE.txt', 'FACE-NOTICE.txt', 'Apache-2.0.txt'].map(name => readFile(new URL(`scripts/editor-vision-notices/${name}`, root), 'utf8')));
// three.js is MIT: its notice ships with every copy, inside the document and next to it.
const threeLicense = await readFile(new URL('node_modules/three/LICENSE', root), 'utf8');
notices.push(threeLicense);
// The web live engine + three.js, bundled once. esbuild drops legal comments, which is why the licence above is carried explicitly.
const liveBundle = (await build({ entryPoints: [fileURLToPath(new URL('./live-edit-live-entry.mjs', import.meta.url))], bundle: true, write: false, format: 'iife',
    target: 'es2020', minify: true, platform: 'browser', logLevel: 'silent', legalComments: 'none', metafile: true, absWorkingDir: fileURLToPath(root) }));
const liveBundleText = liveBundle.outputFiles[0].text;
// The 2D wig art as data: images (the page has no URL space and its CSP only allows img-src data:).
const wigFiles = {}, wigSources = [];
for (const name of (await readdir(new URL('public/photo-studio/wigs/', root))).filter(n => n.endsWith('.svg')).sort())
    wigSources.push(`public/photo-studio/wigs/${name}`), wigFiles[`/photo-studio/wigs/${name}`] = `data:image/svg+xml;base64,${(await readFile(new URL(`public/photo-studio/wigs/${name}`, root))).toString('base64')}`;
const runtime = await readFile(new URL('./live-edit-webview.js', import.meta.url), 'utf8');
// data: WASM fetches work from an opaque/file origin; no file:// fetch or HTTP origin needed.
// Only this isolated hidden document permits WASM. No website CSP is changed.
const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' data:; connect-src data:; img-src data:; style-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'"><script type="application/json" id="licenses">${JSON.stringify(notices).replaceAll('<', '\\u003c')}</script><script>${bundle.replaceAll('</script', '<\\/script')}</script><script>${liveBundleText.replaceAll('</script', '<\\/script')}</script><script>const WIG_FILES=${JSON.stringify(wigFiles)};globalThis.__veyrnoxAssetUrl=path=>WIG_FILES[path];\nconst LIVE_ASSETS=${JSON.stringify(assets)};\n${runtime}</script>`;
await mkdir(output, { recursive: true });
await writeFile(new URL('runtime.html', output), html);
await writeFile(new URL('THREE-LICENSE.txt', output), threeLicense);
for (const [target, source] of [['NOTICE.txt', 'NOTICE.txt'], ['FACE-NOTICE.txt', 'FACE-NOTICE.txt'], ['Apache-2.0.txt', 'Apache-2.0.txt']]) {
    await writeFile(new URL(target, output), await readFile(new URL(`scripts/editor-vision-notices/${source}`, root)));
}
// Every file the bundle or the document embeds, by repo-relative path, so Metro refuses a stale runtime after ANY of them changes
// (the web engine, the shared packages, three.js, the wig art), not only the glue and this script.
const inputs = {};
for (const relative of [...Object.keys(liveBundle.metafile.inputs), ...wigSources, 'node_modules/three/LICENSE'])
    inputs[relative] = createHash('sha256').update(await readFile(new URL(relative, root))).digest('hex');
await writeFile(new URL('manifest.json', output), JSON.stringify({ assets: required, inputs, inventorySha256: createHash('sha256').update(await readFile(new URL('scripts/editor-vision-assets.mjs', root))).digest('hex'), runnerSha256: createHash('sha256').update(runtime).digest('hex'), prepareSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'), htmlBytes: Buffer.byteLength(html), htmlSha256: createHash('sha256').update(html).digest('hex') }, null, 2));
console.log(`Prepared offline mobile vision: ${Buffer.byteLength(html)} bytes HTML; all ${required.length} pinned inputs verified.`);
