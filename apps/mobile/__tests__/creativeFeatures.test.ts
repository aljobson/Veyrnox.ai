import { CREATIVE_FEATURES, CREATIVE_FEATURE_GROUPS, creativeFeature, featurePrompt } from '../src/lib/creativeFeatures';
import { compatibleCreativeFeatures, creativeReuseHref, creativeReuseTargetHref, kindForMime, readCreativeReuse } from '../src/lib/creativeReuse';
declare const require: (id: string) => any;
declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
const { join } = require('path') as { join: (...parts: string[]) => string };

describe('guided creative feature registry', () => {
    test('contains every website workflow exactly once in website order', () => {
        const expected = ['ai-avatar-generator', 'talking-avatar', 'ai-human-generator', 'ai-influencer-generator', 'text-to-speech', 'ai-voice-cloning', 'ai-hairstyle-changer', 'ai-hair-color-changer', 'ai-baby-generator', 'lip-sync', 'ai-talking-photo-generator', 'singing-photo', 'avatar-dialogue', 'video-dubbing', 'talking-cartoon', 'talking-animals', 'ai-baby-podcast', 'talking-objects', 'ai-ad-clone', 'product-avatar', 'product-video-generator', 'product-image-generator'];
        expect(CREATIVE_FEATURES.map((feature) => feature.slug)).toEqual(expected);
        expect(new Set(expected).size).toBe(22);
        expect(CREATIVE_FEATURE_GROUPS).toEqual(['Avatars', 'Voice', 'Photo', 'Performance', 'Characters', 'Commerce']);
    });

    test('every workflow has a live handoff contract and working example', () => {
        for (const feature of CREATIVE_FEATURES) {
            expect(feature.model).toMatch(/^[a-z0-9][a-z0-9.-]+$/);
            expect(feature.steps).toHaveLength(3);
            expect(feature.example.url).toMatch(/^https:\/\/cdn\.lipsync\.video\//);
            if (feature.example.kind === 'video') expect(feature.example.posterUrl).toMatch(/^https:\/\/cdn\.lipsync\.video\//);
            expect(feature.example.sourceUrl).toMatch(/^https:\/\/lipsync\.video\//);
            expect(creativeFeature(feature.slug)).toBe(feature);
        }
        expect(featurePrompt(creativeFeature('ai-hairstyle-changer')!, 'Long curls')).toMatch(/Requested hairstyle: Long curls$/);
        expect(creativeFeature('text-to-speech')?.model).toBe('inworld-tts');
    });

    test('mobile routes provide the hub, detail, example, upload, consent and Create handoff', () => {
        const root = join(__dirname, '..', 'src', 'app', '(app)', 'features');
        const hub = readFileSync(join(root, 'index.tsx'), 'utf8');
        const detail = readFileSync(join(root, '[slug].tsx'), 'utf8');
        const create = readFileSync(join(root, '..', 'create', '[modelId].tsx'), 'utf8');
        expect(hub).toContain('CREATIVE_FEATURE_GROUPS');
        expect(hub).toContain('feature.example.posterUrl ?? feature.example.url');
        expect(hub).toContain('contentFit="contain"');
        expect(detail).toContain('<Example feature={feature} />');
        expect(detail).toContain('DocumentPicker.getDocumentAsync');
        expect(detail).toContain("pathname: '/create/[modelId]'");
        expect(detail).toContain('REQUIRED SOURCES');
        expect(detail).toContain('<SourcePicker');
        expect(detail).toContain('accessibilityRole="checkbox"');
        expect(detail).toContain('stageCreativeSourceHandoff');
        expect(detail).toContain("feature.kind === 'video' ? '9:16' : '1:1'");
        expect(detail).not.toContain('model.name');
        expect(create).toContain('readCreativeSourceHandoff');
        expect(create).toContain('sourceRights: hasReference ? sourceRights : undefined');
        expect(create).toContain("t('form.sourceRights')");
        expect(create).toContain('o.aspects.includes(guidedAspect)');
    });
});

describe('reuse a finished creation in a compatible guided tool', () => {
    test('validates route input and maps media types', () => {
        expect(kindForMime('image/png')).toBe('image');
        expect(kindForMime('video/mp4')).toBe('video');
        expect(kindForMime('audio/mpeg')).toBe('audio');
        expect(kindForMime('application/zip')).toBeNull();
        expect(readCreativeReuse('job_123', 'image')).toEqual({ jobId: 'job_123', kind: 'image' });
        expect(readCreativeReuse('../job', 'image')).toBeNull();
        expect(readCreativeReuse('job_123', 'document')).toBeNull();
    });

    test('shows only tools with a matching source slot and preserves no asset URL', () => {
        const reuse = { jobId: 'job_123', kind: 'audio' } as const;
        const compatible = compatibleCreativeFeatures('audio');
        expect(compatible.length).toBeGreaterThan(0);
        expect(compatible.every((feature) => feature.media.includes('audio'))).toBe(true);
        expect(compatible.map((feature) => feature.slug)).toContain('talking-avatar');
        expect(compatible.map((feature) => feature.slug)).not.toContain('product-image-generator');
        expect(creativeReuseHref(reuse.jobId, reuse.kind)).toEqual({ pathname: '/features', params: { sourceJobId: 'job_123', sourceKind: 'audio' } });
        expect(creativeReuseTargetHref('talking-avatar', reuse)).toEqual({ pathname: '/features/[slug]', params: { slug: 'talking-avatar', sourceJobId: 'job_123', sourceKind: 'audio' } });
    });

    test('hub, detail and picker carry the validated Library job without an asset URL', () => {
        const root = join(__dirname, '..', 'src', 'app', '(app)', 'features');
        const hub = readFileSync(join(root, 'index.tsx'), 'utf8');
        const detail = readFileSync(join(root, '[slug].tsx'), 'utf8');
        const picker = readFileSync(join(__dirname, '..', 'src', 'components', 'SourcePicker.tsx'), 'utf8');
        expect(hub).toContain('compatibleCreativeFeatures(reuse.kind)');
        expect(hub).toContain('creativeReuseTargetHref(feature.slug, reuse)');
        expect(detail).toContain('{ [reuse.kind]: reuse.jobId }');
        expect(detail).toContain('initialReady={reuse?.kind === slot.slot}');
        expect(picker).toContain('initialReadyLabel');
    });
});
