import { readFileSync } from 'fs';
import { join } from 'path';
import { CREATIVE_FEATURES, examplePlaysOn } from '../src/lib/creativeFeatures';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('guided features entry and play badge', () => {
    it('shows no play badge for a WebM example on iOS but does on Android', () => {
        const webm = { kind: 'video' as const, url: 'https://example.test/clip.webm', posterUrl: 'https://example.test/clip.jpg' };
        expect(examplePlaysOn(webm, 'ios')).toBe(false);
        expect(examplePlaysOn(webm, 'android')).toBe(true);
    });

    it('shows a play badge for an MP4 example on iOS and none for a still', () => {
        const mp4 = CREATIVE_FEATURES.find(f => f.example.kind === 'video' && /\.mp4/i.test(f.example.url));
        const still = CREATIVE_FEATURES.find(f => f.example.kind === 'image');
        expect(examplePlaysOn(mp4!.example, 'ios')).toBe(true);
        expect(examplePlaysOn(still!.example, 'ios')).toBe(false);
    });

    it('the list drives its badge from examplePlaysOn, and Create links to the list', () => {
        const list = read('src/app/(app)/features/index.tsx');
        expect(list).toContain('examplePlaysOn(feature.example, Platform.OS)');
        expect(list).not.toContain("feature.example.kind === 'video' ?");
        expect(read('src/app/(app)/(tabs)/create.tsx')).toMatch(/features\.creativetools[\s\S]{0,80}router\.push\('\/features'\)/);
    });
});
