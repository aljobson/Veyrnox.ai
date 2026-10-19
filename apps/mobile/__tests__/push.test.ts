import { ApiError } from '../src/lib/api';
import { isPushToken, jobRouteFromPush, registerDevice, removeDevice, type DeviceInput } from '../src/lib/push';

const JOB = '123e4567-e89b-42d3-a456-426614174000';
const device = (over: Partial<DeviceInput> = {}): DeviceInput => ({
    token: 'ExponentPushToken[abcDEF123_-xyz]', platform: 'ios', deviceId: 'install-12345678', appVersion: '1.0.0', notifyJobs: true, ...over,
});
const fail = (status: number, code: string) => jest.fn().mockRejectedValue(new ApiError(status, code));

describe('isPushToken', () => {
    test('accepts Expo push tokens and nothing else', () => {
        expect(isPushToken('ExponentPushToken[abc123]')).toBe(true);
        expect(isPushToken('ExpoPushToken[abc123]')).toBe(true);
        for (const bad of ['', 'abc', 'ExponentPushToken[]', 'ExponentPushToken[a b]', 'FCM:abc', null, 5]) expect(isPushToken(bad)).toBe(false);
    });
});

describe('registerDevice', () => {
    test('posts the server body shape', async () => {
        const request = jest.fn().mockResolvedValue({ registered: true, notify_jobs: false });
        expect(await registerDevice({ request }, device({ notifyJobs: false }))).toEqual({ kind: 'registered', notifyJobs: false });
        const [path, init] = request.mock.calls[0];
        expect(path).toBe('/api/v1/devices');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({
            token: 'ExponentPushToken[abcDEF123_-xyz]', platform: 'ios', device_id: 'install-12345678', app_version: '1.0.0', notify_jobs: false,
        });
    });
    test('a 404 means push is unavailable and a 429 means back off', async () => {
        expect(await registerDevice({ request: fail(404, 'not_found') }, device())).toEqual({ kind: 'unavailable' });
        expect(await registerDevice({ request: fail(429, 'rate_limited') }, device())).toEqual({ kind: 'rate_limited' });
    });
    test('other errors are a plain failure, and a bad token never reaches the server', async () => {
        expect(await registerDevice({ request: fail(502, 'push_unavailable') }, device())).toEqual({ kind: 'failed' });
        const request = jest.fn();
        expect(await registerDevice({ request }, device({ token: 'nope' }))).toEqual({ kind: 'failed' });
        expect(request).not.toHaveBeenCalled();
    });
});

describe('removeDevice', () => {
    test('sends the token to DELETE /api/v1/devices', async () => {
        const request = jest.fn().mockResolvedValue({ removed: true });
        expect(await removeDevice({ request }, 'ExponentPushToken[abc123]')).toBe(true);
        const [path, init] = request.mock.calls[0];
        expect(path).toBe('/api/v1/devices');
        expect(init.method).toBe('DELETE');
        expect(JSON.parse(init.body)).toEqual({ token: 'ExponentPushToken[abc123]' });
    });
    test('never throws, so sign-out is not blocked', async () => {
        expect(await removeDevice({ request: fail(0, 'network') }, 'ExponentPushToken[abc123]')).toBe(false);
        expect(await removeDevice({ request: jest.fn() }, 'bad')).toBe(false);
    });
});

describe('jobRouteFromPush', () => {
    test('opens the job screen for a well-formed job push', () => {
        expect(jobRouteFromPush({ type: 'job', job_id: JOB, state: 'succeeded' })).toBe(`/job/${JOB}`);
    });
    test('opens nothing for anything else', () => {
        for (const bad of [null, undefined, 'x', {}, { type: 'chat', job_id: JOB }, { type: 'job' }, { type: 'job', job_id: '../admin' }, { type: 'job', job_id: 5 }]) {
            expect(jobRouteFromPush(bad)).toBeNull();
        }
    });
});
