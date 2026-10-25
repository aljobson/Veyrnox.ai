declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };
const screen = (rel: string) => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', '(app)', rel), 'utf8');

import { editHref, makeAnotherHref, nextStepsFor, preloadJob, publishHref } from '../src/lib/nextSteps';

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
        expect(editHref('job-1')).toEqual({ pathname: '/edit', params: { jobId: 'job-1' } });
        expect(publishHref('job-1')).toEqual({ pathname: '/publish/compose', params: { jobId: 'job-1' } });
        expect(makeAnotherHref('kling-3')).toEqual({ pathname: '/create/[modelId]', params: { modelId: 'kling-3' } });
    });
});

describe('preloading a job into Quick edit', () => {
    const job = (id: string) => ({ job_id: id, state: 'succeeded', credits: 3, model_id: 'kling-3', created_at: '2026-10-19T10:00:00Z', has_asset: true }) as const;

    test('uses the listed job when the Library page has it', () => {
        const listed = job('a');
        expect(preloadJob([job('b'), listed], 'a')).toBe(listed);
    });

    test('builds a minimal finished video job when the id is older than the first page', () => {
        const made = preloadJob([job('b')], 'older');
        expect(made).toMatchObject({ job_id: 'older', state: 'succeeded', has_asset: true });
    });

    test('ignores a missing or malformed id', () => {
        expect(preloadJob([job('b')], undefined)).toBeNull();
        expect(preloadJob([job('b')], '')).toBeNull();
        expect(preloadJob([job('b')], 'not a uuid / ../x')).toBeNull();
    });
});

describe('the screens use them', () => {
    test('the result screen offers the three steps with the file or model carried over', () => {
        const job = screen('job/[id].tsx');
        expect(job).toContain('router.push(editHref(id))');
        expect(job).toContain('router.push(publishHref(id))');
        expect(job).toContain('router.push(makeAnotherHref(modelId))');
        expect(job).toContain('router.push(creativeReuseHref(id, reusableKind))');
        expect(job).toContain("accessibilityRole=\"header\">{t('job.next.title')}");
    });

    test('Quick edit and the composer read the job id they are given', () => {
        expect(screen('edit/index.tsx')).toContain('preloadJob(videos, startWith)');
        expect(screen('publish/compose.tsx')).toContain("jobId: presetJob");
    });
});
