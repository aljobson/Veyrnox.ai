import { ODDLINGS } from '../src/lib/oddlings';
import { PUPPET_SCRIPT } from '../src/lib/oddlings/puppetScript';
import { PORTRAIT_BYTES_MAX, isWebp, portraitDataUri, puppetEvent, puppetHtml, puppetPlaying, puppetStart, toBase64 } from '../src/lib/oddlingsPuppet';

declare const require: (id: string) => any;
declare const __dirname: string;
const { spawnSync } = require('child_process') as { spawnSync: (cmd: string, args: string[], opts: object) => { status: number | null; stderr: string } };
const { join } = require('path') as { join: (...p: string[]) => string };
const { Buffer } = require('buffer') as { Buffer: { from(b: Uint8Array): { toString(enc: string): string } } };

interface Rig { head: number[][]; eyes: number[][]; chest: number[]; arms: number[][]; lower: number[]; pivot: number[] }
const bundle = new Function(`${PUPPET_SCRIPT}\nreturn __m;`)() as {
    oddlingPuppetRigs: { puppetRig(id: string): Rig | null; puppetPose(t: number, id: string): Record<string, number> };
    oddlingPuppetRenderer: { createOddlingPuppet: unknown; PUPPET_FRAGMENT_SHADER: string };
};

const webp = (extra = 20) => {
    const bytes = new Uint8Array(12 + extra);
    bytes.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
    bytes.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
    return bytes;
};

describe('the moving preview', () => {
    test('the generated script matches the web files', () => {
        const run = spawnSync(process.execPath, [join(__dirname, '..', 'scripts', 'sync-oddlings-puppet.mjs'), '--check'], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
        expect(run.stderr).toBe('');
        expect(run.status).toBe(0);
    });

    test('every curated character has a rig that stays inside the 1024 by 1536 portrait and a finite pose', () => {
        expect(ODDLINGS).toHaveLength(20);
        for (const o of ODDLINGS) {
            const rig = bundle.oddlingPuppetRigs.puppetRig(o.id);
            expect(rig).not.toBeNull();
            for (const [x, y] of [...(rig as Rig).head, (rig as Rig).pivot]) {
                expect(x).toBeGreaterThanOrEqual(0);
                expect(x).toBeLessThanOrEqual(1024);
                expect(y).toBeGreaterThanOrEqual(0);
                expect(y).toBeLessThanOrEqual(1536);
            }
            expect((rig as Rig).eyes).toHaveLength(2);
            for (const t of [0, 0.7, 3.3, 41]) {
                for (const v of Object.values(bundle.oddlingPuppetRigs.puppetPose(t, o.id))) expect(Number.isFinite(v)).toBe(true);
            }
        }
        expect(bundle.oddlingPuppetRigs.puppetRig('not-a-character')).toBeNull();
        expect(bundle.oddlingPuppetRigs.puppetRig('constructor')).toBeNull();
    });

    test('base64 matches the standard encoding for every tail length', () => {
        for (const n of [0, 1, 2, 3, 4, 5, 255]) {
            const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);
            expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
        }
    });

    test('only a WebP of sane size becomes a picture for the page', () => {
        expect(isWebp(webp())).toBe(true);
        expect(portraitDataUri(webp())?.startsWith('data:image/webp;base64,')).toBe(true);
        const png = webp();
        png.set([0x89, 0x50, 0x4e, 0x47], 0);
        expect(isWebp(png)).toBe(false);
        expect(isWebp(new Uint8Array(0))).toBe(false);
        expect(isWebp(webp(PORTRAIT_BYTES_MAX))).toBe(false);
    });

    test('the page loads nothing from the network and has a strict content policy', () => {
        const html = puppetHtml();
        expect(html).toContain("default-src 'none'");
        expect(html).toContain('img-src data:');
        expect(html.includes('http://')).toBe(false);
        expect(html.includes('https://')).toBe(false);
        expect(html.match(/<\/script/g)).toHaveLength(1);
        expect(html).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|importScripts)\b/);
    });

    test('a start call is made only for a cast character and a WebP address', () => {
        const uri = portraitDataUri(webp()) as string;
        const call = puppetStart(ODDLINGS[0].id, uri, true) as string;
        expect(call.startsWith('window.start("data:image/webp;base64,')).toBe(true);
        expect(call).toContain(`"${ODDLINGS[0].id}",true`);
        expect(puppetStart('</script><b>', uri, true)).toBeNull();
        expect(puppetStart(ODDLINGS[0].id, 'https://example.com/a.webp', true)).toBeNull();
        expect(puppetStart(ODDLINGS[0].id, 'data:text/html;base64,AAAA', true)).toBeNull();
        expect(puppetPlaying(false)).toBe('window.setPlaying(false);true;');
    });

    test('the page reports only its own two words', () => {
        expect(puppetEvent('ready')).toBe('ready');
        expect(puppetEvent('failed')).toBe('failed');
        expect(puppetEvent('<img onerror=1>')).toBeNull();
    });
});
