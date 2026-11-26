import { readFileSync } from 'fs';
import { join } from 'path';
import { CREATIVE_FEATURE_DIRECTORY, CREATIVE_FEATURES, creativeFeatureOwner, examplePlaysOn } from '../src/lib/creativeFeatures';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('guided features entry and play badge', () => {
    it('shows no play badge for a WebM example on iOS but does on Android', () => {
        const webm = CREATIVE_FEATURES.find(f => f.example.kind === 'video' && /\.webm/i.test(f.example.url));
        expect(webm).toBeDefined();
        expect(examplePlaysOn(webm!.example, 'ios')).toBe(false);
        expect(examplePlaysOn(webm!.example, 'android')).toBe(true);
    });

    it('shows a play badge for an MP4 example on iOS and none for a still', () => {
        const mp4 = CREATIVE_FEATURES.find(f => f.example.kind === 'video' && /\.mp4/i.test(f.example.url));
        const still = CREATIVE_FEATURES.find(f => f.example.kind === 'image');
        expect(examplePlaysOn(mp4!.example, 'ios')).toBe(true);
        expect(examplePlaysOn(still!.example, 'ios')).toBe(false);
    });

    it('keeps one discovery owner for every guided capability', () => {
        expect(CREATIVE_FEATURE_DIRECTORY).toEqual([]);
        expect(creativeFeatureOwner(CREATIVE_FEATURES.find(feature => feature.slug === 'text-to-speech')!)).toBe('audio');
        expect(CREATIVE_FEATURES.filter(feature => creativeFeatureOwner(feature) === 'tools').length).toBe(CREATIVE_FEATURES.length - 1);
    });

    it('keeps the recipe list contextual and sends ordinary discovery to Tools', () => {
        const list = read('src/app/(app)/features/index.tsx');
        expect(list).toContain('examplePlaysOn(feature.example, Platform.OS)');
        expect(list).toContain('if (!reuse) return <Redirect href="/create/tools" />');
        expect(list).toContain('const available = compatibleCreativeFeatures(reuse.kind)');
        expect(list).not.toContain("feature.example.kind === 'video' ?");
        expect(list).not.toContain('all-features-directory');
        expect(list).not.toContain('directoryFeatures');
        expect(read('src/app/(app)/(tabs)/create.tsx')).not.toContain("router.push('/features')");
    });
});
