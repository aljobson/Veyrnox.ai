import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { GenerationProgress, formatElapsed } from '../src/components/GenerationProgress';
import { CAP_PERCENT, elapsedSeconds, estimatePercent, expectedDurationMs, jobStartedAt, noteJobStarted } from '../src/lib/generationProgress';
import { t } from '../src/lib/i18n';

void [RN.View, RN.Text];

describe('estimatePercent', () => {
    test('starts at 0, rises, and never passes the cap before the job settles', () => {
        const expected = 40_000;
        expect(estimatePercent(0, expected)).toBe(0);
        const samples = [5_000, 20_000, 40_000, 120_000, 3_600_000].map(ms => estimatePercent(ms, expected));
        samples.reduce((prev, next) => { expect(next).toBeGreaterThanOrEqual(prev); return next; }, 0);
        expect(samples[0]).toBeGreaterThan(0);
        expect(Math.max(...samples)).toBeLessThanOrEqual(CAP_PERCENT);
        expect(estimatePercent(3_600_000, expected)).toBe(CAP_PERCENT);
    });

    test('matches the website formula at the usual duration (about 87%)', () => {
        expect(estimatePercent(40_000, 40_000)).toBe(Math.floor(95 * (1 - Math.exp(-2.5))));
    });

    test('treats bad input as no time spent and a default duration', () => {
        expect(estimatePercent(Number.NaN, 40_000)).toBe(0);
        expect(estimatePercent(-5, 40_000)).toBe(0);
        expect(estimatePercent(40_000, 0)).toBe(estimatePercent(40_000, 40_000));
    });
});

describe('expectedDurationMs', () => {
    test('uses measured times, then the model name, then the kind', () => {
        expect(expectedDurationMs('ace-step-1.5')).toBe(210_000);
        expect(expectedDurationMs('veo-3.1-lite')).toBe(150_000);
        expect(expectedDurationMs('elevenlabs-tts')).toBe(60_000);
        expect(expectedDurationMs('nano-banana')).toBe(40_000);
        expect(expectedDurationMs(null, 'video')).toBe(150_000);
        expect(expectedDurationMs(undefined, 'audio')).toBe(60_000);
        expect(expectedDurationMs(undefined, 'image')).toBe(40_000);
    });
});

describe('job start times', () => {
    test('the first recorded time wins, so the bar does not restart on a new screen', () => {
        expect(noteJobStarted('job-a', 1_000)).toBe(1_000);
        expect(noteJobStarted('job-a', 9_000)).toBe(1_000);
        expect(jobStartedAt('job-a')).toBe(1_000);
        expect(jobStartedAt('job-unknown')).toBeUndefined();
        expect(elapsedSeconds(1_000, 4_500)).toBe(3);
        expect(elapsedSeconds(5_000, 1_000)).toBe(0);
    });
});

describe('formatElapsed', () => {
    test('shows seconds, then minutes and seconds', () => {
        expect(formatElapsed(45)).toBe(t('libraryCreate.elapsed', { seconds: '45' }));
        expect(formatElapsed(78)).toBe(t('job.elapsedMinutes', { minutes: '1', seconds: '18' }));
    });
});

describe('GenerationProgress', () => {
    let root: Root;
    const bar = () => root.container.queryAll(n => n.props.accessibilityRole === 'progressbar')[0];
    const text = (message: string) => root.container.queryAll(n => n.children.join('') === message);
    beforeEach(() => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        jest.useFakeTimers();
        jest.setSystemTime(100_000);
        root = createRoot();
    });
    afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });

    test('shows a labelled bar, a percentage, the patience line and the elapsed time', async () => {
        await act(async () => root.render(<GenerationProgress jobId="job-full" modelId="veo-3.1-lite" />));
        expect(bar().props.accessibilityLabel).toBe(t('job.progressLabel'));
        expect(bar().props.accessibilityValue).toEqual({ min: 0, max: 100, now: 0, text: t('job.percent', { percent: '0' }) });
        expect(text(t('job.patient')).length).toBeGreaterThan(0);
        expect(text(t('job.waiting', { elapsed: formatElapsed(0) })).length).toBeGreaterThan(0);

        await act(async () => { jest.advanceTimersByTime(78_000); });
        const expected = estimatePercent(78_000, expectedDurationMs('veo-3.1-lite'));
        expect(expected).toBeGreaterThan(0);
        expect(bar().props.accessibilityValue.now).toBe(expected);
        expect(text(t('job.percent', { percent: String(expected) })).length).toBeGreaterThan(0);
        expect(text(t('job.waiting', { elapsed: formatElapsed(78) })).length).toBeGreaterThan(0);
    });

    test('compact rows skip the patience line and continue from a stored start time', async () => {
        await act(async () => root.render(<GenerationProgress jobId="job-compact" kind="image" startedAt={80_000} compact />));
        expect(text(t('job.patient'))).toHaveLength(0);
        expect(text(t('job.elapsedSoFar', { elapsed: formatElapsed(20) })).length).toBeGreaterThan(0);
        expect(bar().props.accessibilityValue.now).toBe(estimatePercent(20_000, 40_000));
    });
});
