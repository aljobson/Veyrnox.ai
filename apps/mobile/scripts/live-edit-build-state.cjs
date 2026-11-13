const fs = require('node:fs');
const path = require('node:path');
const STUB = '<!doctype html><script>window.liveEditReceive=function(raw){window.ReactNativeWebView.postMessage(JSON.stringify({id:JSON.parse(raw).id,error:true}))}</script>';
// Accept only the audited literal declaration, with optional boolean annotation/comments.
// Expressions, extra declarations and ambiguous comments must fail the build, not enable it.
function readEnabled(appRoot = path.resolve(__dirname, '..')) {
    const source = fs.readFileSync(path.join(appRoot, 'src/lib/photoStudioFlag.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim();
    const match = /^export\s+const\s+PHOTO_STUDIO_ENABLED\s*(?::\s*boolean\s*)?=\s*(true|false)\s*;?$/.exec(code);
    if (!match) throw Error('Live Edit flag must be exactly export const PHOTO_STUDIO_ENABLED[: boolean] = true or false; expressions are not supported.');
    return match[1] === 'true';
}
function writeDarkStub(appRoot = path.resolve(__dirname, '..')) {
    const folder = path.join(appRoot, 'assets/live-edit');
    const file = path.join(folder, 'runtime.html');
    fs.mkdirSync(folder, { recursive: true });
    // Idempotent: a dark Metro start (including a test that loads metro.config.js) touches nothing once the stub is in place.
    // A previously prepared runtime IS replaced on purpose, so a dark release can never bundle the 41 MB runtime.
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== STUB) fs.writeFileSync(file, STUB);
    fs.rmSync(path.join(folder, 'manifest.json'), { force: true });
}
module.exports = { readEnabled, writeDarkStub, STUB };
