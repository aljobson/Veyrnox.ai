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
        const audio = ['text-to-speech', 'lip-sync', 'ai-talking-photo-generator', 'singing-photo', 'video-dubbing'];
        expect(CREATIVE_FEATURES.filter(feature => creativeFeatureOwner(feature) === 'audio').map(feature => feature.slug)).toEqual(audio);
        expect(CREATIVE_FEATURE_DIRECTORY).toHaveLength(CREATIVE_FEATURES.length - audio.length);
        expect(CREATIVE_FEATURE_DIRECTORY.map(feature => feature.slug)).toEqual(expect.arrayContaining([
            'ai-avatar-generator', 'talking-avatar', 'ai-human-generator', 'ai-influencer-generator',
            'ai-voice-cloning', 'avatar-dialogue', 'talking-cartoon', 'talking-animals',
            'ai-baby-podcast', 'ai-ad-clone', 'product-avatar',
            'product-video-generator', 'product-image-generator',
        ]));
    });

    it('keeps contextual reuse and restores ordinary Creative tools discovery', () => {
        const list = read('src/app/(app)/features/index.tsx');
        expect(list).toContain('examplePlaysOn(feature.example, Platform.OS)');
        expect(list).not.toContain('Redirect');
        expect(list).toContain('reuse ? compatibleCreativeFeatures(reuse.kind) : CREATIVE_FEATURE_DIRECTORY');
        expect(list).toContain("pathname: '/features/[slug]'");
        expect(list).not.toContain("feature.example.kind === 'video' ?");
        expect(list).toContain('CREATIVE_FEATURE_DIRECTORY');
        expect(read('src/app/(app)/(tabs)/create.tsx')).not.toContain("router.push('/features')");
    });
});
