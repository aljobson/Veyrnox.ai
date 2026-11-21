import { CREATIVE_FEATURES, creativeFeature } from '../src/lib/creativeFeatures';

const ORIGINAL_STILLS = [
    'ai-avatar-generator', 'text-to-speech', 'ai-voice-cloning',
    'talking-objects', 'product-image-generator',
];

// Shrinking exception list: remove each slug when its original media lands.
// A1 leaves 12 other videos, singing-photo (separate session) (Lip Sync is local since PR #2584).
const LEGACY_EXCEPTIONS = new Set([
    'talking-avatar', 'ai-human-generator', 'ai-influencer-generator',
    'ai-talking-photo-generator', 'singing-photo', 'avatar-dialogue',
    'video-dubbing', 'talking-cartoon', 'talking-animals', 'ai-baby-podcast',
    'ai-ad-clone', 'product-avatar', 'product-video-generator',
]);

test('only explicitly deferred slugs may use competitor examples or posters', () => {
    for (const { slug, example } of CREATIVE_FEATURES) {
        for (const asset of [example.url, example.posterUrl].filter((url): url is string => !!url)) {
            const url = new URL(asset);
            expect(url.protocol).toBe('https:');
            expect(url.username + url.password + url.port).toBe('');
            if (url.origin === 'https://veyrnox.ai') {
                expect(url.pathname).toMatch(/^\/examples\//);
            } else {
                expect(url.origin).toBe('https://cdn.lipsync.video');
                expect(LEGACY_EXCEPTIONS.has(slug)).toBe(true);
            }
        }
    }
    for (const slug of LEGACY_EXCEPTIONS) {
        expect(creativeFeature(slug)).not.toBeNull();
        expect(ORIGINAL_STILLS).not.toContain(slug);
    }
});

test('the five original stills use the public web deployment URLs', () => {
    for (const slug of ORIGINAL_STILLS) {
        expect(creativeFeature(slug)?.example).toEqual({
            kind: 'image', url: `https://veyrnox.ai/examples/${slug}.webp`,
        });
    }
});
