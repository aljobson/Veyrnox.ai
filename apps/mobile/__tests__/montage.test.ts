import { ApiError, type ApiClient } from '../src/lib/api';
import { approvePlan, briefProblem, fetchAgentListing, MAX_NARRATION_LENGTH, minutesLeft, normaliseNarration, planMessage, requestPlan, type Plan } from '../src/lib/montage';

const apiWith = (result: unknown) => {
    const request = jest.fn(async () => {
        if (result instanceof Error) throw result;
        return result;
    });
    return { api: { request } as unknown as ApiClient, request };
};

const plan: Plan = {
    planId: 'tok.sig',
    idempotencyKey: 'plan_test_one',
    seconds: 32,
    summary: 'A short about bees: 6 scenes with voiceover.',
    credits: 165,
    aspect: '9:16',
    narrationText: '',
    expiresAt: 2_000_000_000,
};

describe('briefProblem', () => {
    test('accepts 3 to 500 characters', () => {
        expect(briefProblem('abc')).toBeNull();
        expect(briefProblem('  how bees make honey  ')).toBeNull();
        expect(briefProblem('x'.repeat(500))).toBeNull();
    });

    test('asks for more or less text, and refuses control characters', () => {
        expect(briefProblem('ab')).toBe('too_short');
        expect(briefProblem('   ')).toBe('too_short');
        expect(briefProblem('x'.repeat(501))).toBe('too_long');
        expect(briefProblem('bad\u0007text')).toBe('invalid');
        expect(briefProblem('two\nlines are fine')).toBeNull();
    });
});

describe('requestPlan', () => {
    test('sends the trimmed brief and the aspect, and reads the plan from the response', async () => {
        const { api, request } = apiWith({
            plan_id: 'tok.sig', idempotency_key: 'plan_test_one', plan: { seconds: 32, summary: 'A short about bees.' },
            credits: 165, aspect_ratio: '16:9', expires_at: 2_000_000_000,
        });
        const out = await requestPlan(api, '  how bees make honey ', '16:9');
        const [path, init] = request.mock.calls[0] as unknown as [string, RequestInit];
        expect(path).toBe('/api/v1/montage/plan');
        expect(JSON.parse(init.body as string)).toEqual({ brief: 'how bees make honey', aspect_ratio: '16:9' });
        expect(out).toEqual({ planId: 'tok.sig', idempotencyKey: 'plan_test_one', seconds: 32, summary: 'A short about bees.', credits: 165, aspect: '16:9', narrationText: '', expiresAt: 2_000_000_000 });
    });

    test('does not call the server for a brief that is too short', async () => {
        const { api, request } = apiWith({});
        await expect(requestPlan(api, 'hi', '9:16')).rejects.toMatchObject({ code: 'inputs_invalid:brief' });
        expect(request).not.toHaveBeenCalled();
    });

    test('refuses an answer it cannot use rather than showing a half plan', async () => {
        await expect(requestPlan(apiWith({ plan_id: 'x' }).api, 'how bees make honey', '9:16')).rejects.toMatchObject({ code: 'plan_unavailable' });
        await expect(requestPlan(apiWith({ plan_id: 'x', idempotency_key: 'k', credits: 'lots', plan: {}, expires_at: 1 }).api, 'how bees make honey', '9:16')).rejects.toMatchObject({ code: 'plan_unavailable' });
    });

    test('keeps a missing length as null so the screen can leave it out', async () => {
        const out = await requestPlan(apiWith({ plan_id: 'x', idempotency_key: 'plan_k', plan: { summary: 's' }, credits: 165, aspect_ratio: '9:16', expires_at: 5 }).api, 'how bees make honey', '9:16');
        expect(out.seconds).toBeNull();
    });

    test('sends exact narration separately and only accepts a plan that preserves it', async () => {
        const exact = 'Make every frame matter.';
        const { api, request } = apiWith({
            plan_id: 'tok.sig', idempotency_key: 'plan_test_two', plan: { seconds: 30, summary: 'A launch film.', narration_supported: true },
            credits: 165, aspect_ratio: '9:16', expires_at: 2_000_000_000, narration_text: exact,
        });
        const out = await requestPlan(api, ' launch a new camera ', '9:16', `  ${exact}  `);
        expect(JSON.parse((request.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ brief: 'launch a new camera', aspect_ratio: '9:16', narration_text: exact });
        expect(out.narrationText).toBe(exact);
        await expect(requestPlan(apiWith({ plan_id: 'x', idempotency_key: 'k', plan: { summary: 's' }, credits: 165, aspect_ratio: '9:16', expires_at: 5 }).api, 'a valid brief', '9:16', exact)).rejects.toMatchObject({ code: 'plan_unavailable' });
    });
});

describe('normaliseNarration', () => {
    test('trims valid exact words and refuses unsafe or overlong text', () => {
        expect(normaliseNarration('  Speak this exactly.  ')).toEqual({ ok: true, text: 'Speak this exactly.' });
        expect(normaliseNarration('x'.repeat(MAX_NARRATION_LENGTH))).toEqual({ ok: true, text: 'x'.repeat(MAX_NARRATION_LENGTH) });
        expect(normaliseNarration('x'.repeat(MAX_NARRATION_LENGTH + 1))).toEqual({ ok: false });
        expect(normaliseNarration('two\nlines')).toEqual({ ok: false });
        expect(normaliseNarration('\uD800')).toEqual({ ok: false });
    });
});

describe('approvePlan', () => {
    test('approves with the plan key, the server price and the exact brief and aspect', async () => {
        const { api, request } = apiWith({ job_id: 'job-1' });
        const jobId = await approvePlan(api, plan, ' how bees make honey ');
        const [path, init] = request.mock.calls[0] as unknown as [string, RequestInit];
        expect(path).toBe('/api/v1/generations');
        expect(JSON.parse(init.body as string)).toEqual({
            model_id: 'video-agent',
            idempotency_key: 'plan_test_one',
            confirmed_credits: 165,
            inputs: { brief: 'how bees make honey', plan_id: 'tok.sig', aspect_ratio: '9:16' },
        });
        expect(jobId).toBe('job-1');
    });

    test('has no consent field, because no file is sent', async () => {
        const { api, request } = apiWith({ job_id: 'job-1' });
        await approvePlan(api, plan, 'how bees make honey');
        expect(JSON.parse((request.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).not.toHaveProperty('consent');
    });

    test('approves with the exact narration shown in the plan', async () => {
        const { api, request } = apiWith({ job_id: 'job-2' });
        await approvePlan(api, { ...plan, narrationText: 'Make every frame matter.' }, 'how bees make honey');
        expect(JSON.parse((request.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).inputs.narration_text).toBe('Make every frame matter.');
    });

    test('a second approve of the same plan sends the same key, so it is charged once', async () => {
        const { api, request } = apiWith({ job_id: 'job-1' });
        await approvePlan(api, plan, 'how bees make honey');
        await approvePlan(api, plan, 'how bees make honey');
        const keys = request.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string).idempotency_key);
        expect(keys[0]).toBe(keys[1]);
    });

    test('an answer without a job id is an error, not a silent success', async () => {
        await expect(approvePlan(apiWith({}).api, plan, 'how bees make honey')).rejects.toMatchObject({ code: 'unknown' });
    });
});

describe('minutesLeft', () => {
    test('rounds up to whole minutes and never goes below zero', () => {
        expect(minutesLeft(1000 + 30 * 60, 1000 * 1000)).toBe(30);
        expect(minutesLeft(1000 + 61, 1000 * 1000)).toBe(2);
        expect(minutesLeft(1000, 2000 * 1000)).toBe(0);
    });
});

describe('planMessage', () => {
    test('words each server answer in plain language', () => {
        expect(planMessage(new ApiError(404, 'video_agent_unavailable'))).toMatch(/not available/i);
        expect(planMessage(new ApiError(502, 'plan_unavailable'))).toMatch(/could not make a plan/i);
        expect(planMessage(new ApiError(503, 'video_agent_offline'))).toMatch(/try again/i);
        expect(planMessage(new ApiError(409, 'video_agent_in_progress'))).toMatch(/already have one/i);
        expect(planMessage(new ApiError(409, 'plan_expired'))).toMatch(/ran out/i);
        expect(planMessage(new ApiError(409, 'plan_price_changed'))).toMatch(/price changed/i);
        expect(planMessage(new ApiError(400, 'plan_invalid'))).toMatch(/plan again/i);
        expect(planMessage(new ApiError(400, 'plan_mismatch'))).toMatch(/plan again/i);
        expect(planMessage(new ApiError(400, 'plan_key_mismatch'))).toMatch(/plan again/i);
        expect(planMessage(new ApiError(503, 'narration_unavailable'))).toMatch(/try again/i);
        expect(planMessage(new ApiError(429, 'rate_limited'))).toMatch(/too many/i);
        expect(planMessage(new ApiError(402, 'insufficient_credits'))).toMatch(/not enough credits/i);
        expect(planMessage(new ApiError(0, 'network'))).toMatch(/connection/i);
        expect(planMessage(new Error('x'))).toMatch(/something went wrong/i);
    });

    test('says how long to wait when every slot is busy, using the server value', () => {
        expect(planMessage(new ApiError(409, 'video_agent_busy', { retry_after_seconds: 120 }))).toMatch(/2 minutes/);
        expect(planMessage(new ApiError(409, 'video_agent_busy'))).toMatch(/few minutes/);
    });
});

describe('fetchAgentListing', () => {
    const catalog = (models: unknown[]) => {
        globalThis.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ models }))) as unknown as typeof fetch;
    };

    test('returns the catalog price when the agent is listed and open', async () => {
        catalog([{ id: 'flux', credits: 2, gated: false }, { id: 'video-agent', credits: 165, gated: false }]);
        expect(await fetchAgentListing()).toEqual({ credits: 165 });
    });

    test('returns null when it is missing or gated, or the catalog cannot be read', async () => {
        catalog([{ id: 'flux', credits: 2, gated: false }]);
        expect(await fetchAgentListing()).toBeNull();
        catalog([{ id: 'video-agent', credits: 165, gated: true }]);
        expect(await fetchAgentListing()).toBeNull();
        globalThis.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
        expect(await fetchAgentListing()).toBeNull();
        globalThis.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 500 })) as unknown as typeof fetch;
        expect(await fetchAgentListing()).toBeNull();
    });
});
