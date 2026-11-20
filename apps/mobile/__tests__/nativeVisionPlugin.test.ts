import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// Exercise the real config plugin in Node, where its ESM inventory import runs during prebuild.
const plugin = resolve(__dirname, '../modules/veyrnox-vision/app.plugin.js');
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const noticeNames = ['NOTICE.txt', 'FACE-NOTICE.txt', 'Apache-2.0.txt'];
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'native-vision-models-'));
    const app = join(root, 'apps/mobile'); mkdirSync(app, { recursive: true });
    mkdirSync(join(root, 'scripts/editor-vision-notices'), { recursive: true });
    mkdirSync(join(root, 'app/veyrnox/_lib'), { recursive: true });
    mkdirSync(join(root, 'public/editor-vision/fixture'), { recursive: true });
    const entries = ['face_landmarker.task', 'selfie_multiclass_256x256.tflite'].map((path, index) => {
        const data = Buffer.from([index, 1, 2, 3]);
        writeFileSync(join(root, 'public/editor-vision/fixture', path), data);
        return { path, bytes: data.length, sha256: digest(data), source: `https://must-not-fetch.invalid/${path}` };
    });
    const notices = noticeNames.map(name => {
        const data = Buffer.from(name), source = `scripts/editor-vision-notices/${name}`;
        writeFileSync(join(root, source), data);
        return { path: name === 'FACE-NOTICE.txt' ? 'NOTICE.txt' : name, source, bytes: data.length, sha256: digest(data) };
    });
    // Match the real inventory's duplicated NOTICE.txt path and shared Apache entry.
    const face = [entries[0], notices[1], notices[2]], vision = [entries[1], notices[0], notices[2]];
    writeFileSync(join(root, 'scripts/editor-vision-assets.mjs'), `export const FACE_ASSETS = ${JSON.stringify(face)}; export const VISION_ASSETS = ${JSON.stringify(vision)};`);
    writeFileSync(join(root, 'app/veyrnox/_lib/editorVisionRuntime.mjs'), "export const FACE_VISION_VERSION = 'fixture', EDITOR_VISION_VERSION = 'fixture';");
    const destination = (platform: string) => join(app, 'modules/veyrnox-vision', platform === 'ios' ? 'ios/Models' : 'android/src/main/assets/veyrnox-vision');
    return { root, app, entries, destination };
}
function copy(app: string, platform: string, downloads: Record<string, number[]> = {}): string[] {
    const script = `
        const downloads = JSON.parse(process.argv[4]), fetched = [];
        globalThis.fetch = async url => {
            fetched.push(url);
            if (!(url in downloads)) throw Error('unexpected-download');
            return { ok: true, arrayBuffer: async () => Uint8Array.from(downloads[url]).buffer };
        };
        require(process.argv[1]).copyModels(process.argv[2], process.argv[3])
            .then(() => process.stdout.write(JSON.stringify(fetched)))
            .catch(error => { console.error(error.message); process.exit(7); });
    `;
    return JSON.parse(execFileSync(process.execPath, ['-e', script, plugin, app, platform, JSON.stringify(downloads)], { encoding: 'utf8', stdio: 'pipe' }));
}
test.each(['ios', 'android'])('prebuild bundles verified models/notices for %s and replaces stale prepared models', platform => {
    const f = fixture();
    try {
        expect(copy(f.app, platform)).toEqual([]);
        for (const entry of f.entries) expect(digest(readFileSync(join(f.destination(platform), entry.path)))).toBe(entry.sha256);
        for (const name of noticeNames) expect(readFileSync(join(f.destination(platform), name), 'utf8')).toBe(name);
        for (const entry of f.entries) writeFileSync(join(f.destination(platform), entry.path), Buffer.alloc(entry.bytes, 9));
        // Same-size corruption must fail SHA256 and fall through to the public source without downloading.
        expect(copy(f.app, platform)).toEqual([]);
        for (const entry of f.entries) expect(digest(readFileSync(join(f.destination(platform), entry.path)))).toBe(entry.sha256);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test.each(['ios', 'android'])('stale prepared and public models for %s fall through to a verified download', platform => {
    const f = fixture();
    try {
        copy(f.app, platform);
        const entry = f.entries[0], publicFile = join(f.root, 'public/editor-vision/fixture', entry.path);
        const download = Array.from(readFileSync(publicFile));
        writeFileSync(join(f.destination(platform), entry.path), 'stale'); writeFileSync(publicFile, 'stale');
        expect(copy(f.app, platform, { [entry.source]: download })).toEqual([entry.source]);
        expect(digest(readFileSync(join(f.destination(platform), entry.path)))).toBe(entry.sha256);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test.each(['ios', 'android'])('no verified model source for %s fails without writing downloaded corrupt bytes', platform => {
    const f = fixture();
    try {
        copy(f.app, platform);
        const entry = f.entries[0];
        writeFileSync(join(f.destination(platform), entry.path), 'stale');
        writeFileSync(join(f.root, 'public/editor-vision/fixture', entry.path), 'stale');
        expect(() => copy(f.app, platform, { [entry.source]: [9, 9, 9, 9] })).toThrow('vision-model-hash-mismatch');
        expect(readFileSync(join(f.destination(platform), entry.path), 'utf8')).toBe('stale');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});
describe.each(['ios', 'android'])('%s notice verification', platform => {
    test.each(noticeNames)('tampered %s fails before any bundle resource is written', name => {
        const f = fixture();
        try {
            copy(f.app, platform);
            const target = join(f.destination(platform), f.entries[0].path);
            writeFileSync(target, 'stale');
            // Preserve size to prove the notice digest, not just its byte count, is checked.
            writeFileSync(join(f.root, 'scripts/editor-vision-notices', name), Buffer.alloc(Buffer.byteLength(name), 9));
            expect(() => copy(f.app, platform)).toThrow('vision-notice-hash-mismatch');
            expect(readFileSync(target, 'utf8')).toBe('stale');
            expect(readFileSync(join(f.destination(platform), name), 'utf8')).toBe(name);
        } finally { rmSync(f.root, { recursive: true, force: true }); }
    });
});
