declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };
const screen = (rel: string) => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', '(app)', rel), 'utf8');

import { editHref, makeAnotherHref, nextStepsFor, publishHref } from '../src/lib/nextSteps';

describe('next steps after a result (N5)', () => {
    test('a video can be edited, published or made again', () => {
        expect(nextStepsFor('video/mp4', 'kling-3')).toEqual({ edit: true, publish: true, makeAnother: true, reuse: true });
    });

    test('an image can be published or made again, not edited', () => {
        expect(nextStepsFor('image/png', 'nano-banana')).toEqual({ edit: false, publish: true, makeAnother: true, reuse: true });
        expect(nextStepsFor('image/webp', 'seedream-4')).toEqual({ edit: false, publish: true, makeAnother: true, reuse: true });
    });

    test('audio can be made again or reused: the publishing composer takes images and videos', () => {
        expect(nextStepsFor('audio/mpeg', 'tts-1')).toEqual({ edit: false, publish: false, makeAnother: true, reuse: true });
    });

    test('Make another needs the model; without it only the file steps show', () => {
        expect(nextStepsFor('video/mp4', null)).toEqual({ edit: true, publish: true, makeAnother: false, reuse: true });
        expect(nextStepsFor('image/png', '')).toEqual({ edit: false, publish: true, makeAnother: false, reuse: true });
    });

    test('an unknown file type offers nothing it cannot honour', () => {
        expect(nextStepsFor('application/zip', 'm')).toEqual({ edit: false, publish: false, makeAnother: true, reuse: false });
    });

    test('the links carry the file or the model', () => {
        expect(editHref('job-1')).toEqual({ pathname: '/editor/new', params: { jobId: 'job-1' } });
        expect(publishHref('job-1')).toEqual({ pathname: '/publish/compose', params: { jobId: 'job-1' } });
        expect(makeAnotherHref('kling-3')).toEqual({ pathname: '/create/[modelId]', params: { modelId: 'kling-3' } });
    });
});

describe('the screens use them', () => {
    test('the result screen offers the three steps with the file or model carried over', () => {
        const job = screen('job/[id].tsx');
        expect(job).toContain('router.push(editHref(id))');
        expect(job).toContain('router.push(publishHref(id))');
        expect(job).toContain('submittedHref(api, id, modelId, current)');
        expect(job).toContain('onPress={() => void reopen(false)}');
        expect(job).toContain('onPress={() => void reopen(true)}');
        expect(job).toContain('router.push(creativeReuseHref(id, reusableKind))');
        expect(job).toContain("accessibilityRole=\"header\">{t('job.next.title')}");
    });

    test('the Editor and the composer read the job id they are given', () => {
        expect(screen('editor/new.tsx')).toContain('useLocalSearchParams<{ jobId?: string; blank?: string }>()');
        expect(screen('edit/index.tsx')).toContain("pathname: '/editor/new', params: { jobId }");
        expect(screen('publish/compose.tsx')).toContain("jobId: presetJob");
    });
});
