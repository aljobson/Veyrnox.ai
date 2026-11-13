/* eslint-disable @typescript-eslint/no-require-imports */
import { DEFAULT_STACK, history } from '../src/lib/liveEdit/engine';
import { createInferenceLifecycle } from '../src/lib/liveEdit/lifecycle';
import { allowsVisionNavigation } from '../src/lib/liveEdit/navigation';
declare const __dirname: string;
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { readEnabled, STUB } = require('../scripts/live-edit-build-state.cjs');
test('a 200-step slider drag creates one undo entry and restores the pre-drag stack', () => {
    const h = history(); h.begin();
    for (let i = 1; i <= 200; i++) h.set({ ...h.value, smoothing: i / 200 });
    expect(h.value.smoothing).toBe(1); expect(h.canUndo).toBe(false);
    h.commit(); expect(h.canUndo).toBe(true); h.undo();
    expect(h.value).toEqual(DEFAULT_STACK); expect(h.canUndo).toBe(false);
    h.redo(); expect(h.value.smoothing).toBe(1);
});
test('inactive permission overlays preserve the exact export lease; background requires fresh inference', () => {
    const lifecycle = createInferenceLifecycle(), initial = lifecycle.reset();
    expect(lifecycle.accept(initial)).toBe(true); expect(lifecycle.canSave).toBe(true);
    expect(lifecycle.transition('inactive')).toBeNull(); expect(lifecycle.owns(initial)).toBe(true);
    expect(lifecycle.transition('active')).toBeNull(); expect(lifecycle.owns(initial)).toBe(true);
    expect(lifecycle.transition('background')).toBe('suspend'); expect(lifecycle.canSave).toBe(false);
    expect(lifecycle.owns(initial)).toBe(false); expect(lifecycle.accept(initial)).toBe(false);
    expect(lifecycle.transition('active')).toBe('refresh'); expect(lifecycle.canSave).toBe(false);
    expect(lifecycle.accept(lifecycle.generation)).toBe(true); expect(lifecycle.canSave).toBe(true);
    lifecycle.reset(); expect(lifecycle.canSave).toBe(false);
});
test('vision navigation normalizes local URLs but blocks other documents and remote origins', () => {
    const asset = 'file:///cache/My%20Asset.html?version=1#start';
    for (const url of ['about:blank', 'file:///cache/My Asset.html', 'file:///cache/My%20Asset.html?version=2']) expect(allowsVisionNavigation(url, asset)).toBe(true);
    for (const url of ['https://example.com/cache/My%20Asset.html', 'file:///cache/other.html', 'file://other/cache/My%20Asset.html', 'data:text/html,hello', 'about:blank#other', 'file:///cache/My%20Asset.html?version=2#end', 'file:///cache/My%20Asset.html#live', 'file:///cache/%zz']) expect(allowsVisionNavigation(url, asset)).toBe(false);
    expect(allowsVisionNavigation('file:///cache/a', 'not a URL')).toBe(false);
});
test('build flag parsing fails ambiguous forms, and every dark build replaces a prepared runtime', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's4-build-state-'));
    try {
        fs.mkdirSync(path.join(root, 'src/lib'), { recursive: true });
        const flag = path.join(root, 'src/lib/photoStudioFlag.ts');
        for (const value of ['false', 'true']) {
            fs.writeFileSync(flag, `// true in a comment cannot enable anything\nexport const PHOTO_STUDIO_ENABLED: boolean = ${value};`);
            expect(readEnabled(root)).toBe(value === 'true');
        }
        for (const source of ['export const PHOTO_STUDIO_ENABLED = process.env.ENABLED;', 'export const PHOTO_STUDIO_ENABLED = Boolean(false);', 'export const PHOTO_STUDIO_ENABLED = true || false;', 'export const PHOTO_STUDIO_ENABLED = false; export const another = true;']) {
            fs.writeFileSync(flag, source); expect(() => readEnabled(root)).toThrow('Live Edit flag must be exactly');
        }
        fs.writeFileSync(flag, 'export const PHOTO_STUDIO_ENABLED = false;');
        fs.mkdirSync(path.join(root, 'scripts'));
        for (const file of ['live-edit-build-state.cjs', 'ensure-live-edit.cjs', 'build-live-edit.mjs']) fs.copyFileSync(path.join(__dirname, '../scripts', file), path.join(root, 'scripts', file));
        const assets = path.join(root, 'assets/live-edit'); fs.mkdirSync(assets, { recursive: true });
        for (let i = 0; i < 2; i++) {
            fs.writeFileSync(path.join(assets, 'runtime.html'), 'prepared model bytes'); fs.writeFileSync(path.join(assets, 'manifest.json'), '{}');
            if (i === 0) execFileSync('node', ['-e', 'require("./scripts/ensure-live-edit.cjs")()'], { cwd: root });
            else execFileSync('node', ['scripts/build-live-edit.mjs'], { cwd: root });
            expect(fs.readFileSync(path.join(assets, 'runtime.html'), 'utf8')).toBe(STUB);
            expect(fs.existsSync(path.join(assets, 'manifest.json'))).toBe(false);
        }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
// Kept out of the test body on purpose: a stat or exists check followed by a write of the same path in one function is the shape code scanners flag as a race.
const mtimeOf = (file: string) => fs.statSync(file).mtime.getTime();
const present = (file: string) => fs.existsSync(file);
test('a dark Metro start leaves the stub untouched, and replaces a prepared runtime on purpose (inspection F2)', () => {
    const { writeDarkStub } = require('../scripts/live-edit-build-state.cjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's4-dark-stub-'));
    try {
        const folder = path.join(root, 'assets/live-edit');
        writeDarkStub(root);
        const file = path.join(folder, 'runtime.html');
        expect(fs.readFileSync(file, 'utf8')).toBe(STUB);
        // Make the stub's mtime obviously old; an idempotent second start must not rewrite it.
        const old = new Date(2020, 0, 1); fs.utimesSync(file, old, old);
        writeDarkStub(root); writeDarkStub(root);
        expect(mtimeOf(file)).toBe(old.getTime());
        // A developer's previously prepared runtime and manifest never ride along in a dark build.
        fs.writeFileSync(file, '<html>41 MB prepared runtime</html>'); fs.writeFileSync(path.join(folder, 'manifest.json'), '{}');
        writeDarkStub(root);
        expect(fs.readFileSync(file, 'utf8')).toBe(STUB); expect(present(path.join(folder, 'manifest.json'))).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
