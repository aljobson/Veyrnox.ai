import { ODDLINGS } from '../src/lib/oddlings';
import { puppetRig, puppetPose } from '../../../app/veyrnox/_lib/oddlingPuppetRigs.js';
import { PORTRAIT_BYTES_MAX, isWebp, toBase64 } from '../src/lib/oddlingsPuppet';

const webp = (extra = 20) => {
    const bytes = new Uint8Array(12 + extra);
    bytes.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
    bytes.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
    return bytes;
};

describe('the moving preview', () => {
    test('every curated character has a rig that stays inside the 1024 by 1536 portrait and a finite pose', () => {
        expect(ODDLINGS).toHaveLength(20);
        for (const o of ODDLINGS) {
            const rig = puppetRig(o.id);
            expect(rig).not.toBeNull();
            for (const [x, y] of [...rig!.head, rig!.pivot]) {
                expect(x).toBeGreaterThanOrEqual(0);
                expect(x).toBeLessThanOrEqual(1024);
                expect(y).toBeGreaterThanOrEqual(0);
                expect(y).toBeLessThanOrEqual(1536);
            }
            expect(rig!.eyes).toHaveLength(2);
            for (const t of [0, 0.7, 3.3, 41]) {
                for (const v of Object.values(puppetPose(t, o.id)!)) expect(Number.isFinite(v)).toBe(true);
            }
        }
        expect(puppetRig('not-a-character')).toBeNull();
        expect(puppetRig('constructor')).toBeNull();
    });

    test('base64 matches the standard encoding for every tail length', () => {
        for (const n of [0, 1, 2, 3, 4, 5, 255]) {
            const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);
            expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
        }
    });

    test('only a WebP of sane size is accepted for decoding', () => {
        expect(isWebp(webp())).toBe(true);
        const png = webp();
        png.set([0x89, 0x50, 0x4e, 0x47], 0);
        expect(isWebp(png)).toBe(false);
        expect(isWebp(new Uint8Array(0))).toBe(false);
        expect(isWebp(webp(PORTRAIT_BYTES_MAX))).toBe(false);
    });

});
