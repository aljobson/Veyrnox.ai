declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

import { PROFILE_LIMIT, fetchProfile, resetProfileGuard } from '../src/lib/auth/accountCalls';
import { AuthError } from '../src/lib/auth/supabaseAuth';
import { claimWelcomeRedirect, resetWelcomeRedirect } from '../src/lib/firstRun';
import { forgetMfaCleared, markMfaCleared, mfaClearedFor } from '../src/lib/mfaCheck';
import { createRateGuard, reportIssue, setIssueReporter } from '../src/lib/requestGuard';

describe('the rate guard', () => {
    test('lets the limit through inside a window and then says no', () => {
        let now = 0;
        const guard = createRateGuard(3, 1000, () => now);
        expect([guard.allow(), guard.allow(), guard.allow(), guard.allow()]).toEqual([true, true, true, false]);
    });

    test('lifts by itself once the window has passed, and refusals do not extend it', () => {
        let now = 0;
        const guard = createRateGuard(2, 1000, () => now);
        guard.allow();
        guard.allow();
        now = 900;
        expect(guard.allow()).toBe(false);
        // The first two were allowed at 0, so at 1000 they have aged out; the refusal at 900 counted for nothing.
        now = 1000;
        expect(guard.allow()).toBe(true);
    });

    test('a reporter that throws never breaks the caller', () => {
        setIssueReporter(() => {
            throw new Error('sentry down');
        });
        expect(() => reportIssue('x', { caller: 'y' })).not.toThrow();
        setIssueReporter(() => {});
    });
});

describe('profile reads are capped, so a loop cannot flood the server', () => {
    const reports: [string, Record<string, string>][] = [];
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ email: 'a@b.test', app_metadata: { provider: 'apple' } }) }));
    const token = async () => 'access-token';

    beforeEach(() => {
        reports.length = 0;
        fetchMock.mockClear();
        (globalThis as { fetch?: unknown }).fetch = fetchMock;
        setIssueReporter((message, tags) => reports.push([message, tags]));
        resetProfileGuard();
    });

    afterEach(() => setIssueReporter(() => {}));

    test('the reads inside the limit go through', async () => {
        for (let i = 0; i < PROFILE_LIMIT; i += 1) await expect(fetchProfile(token, 'test')).resolves.toMatchObject({ email: 'a@b.test', provider: 'apple' });
        expect(fetchMock).toHaveBeenCalledTimes(PROFILE_LIMIT);
        expect(reports).toEqual([]);
    });

    test('past the limit the read is refused without a request, and the caller is reported once', async () => {
        for (let i = 0; i < PROFILE_LIMIT; i += 1) await fetchProfile(token, 'loop-test');
        const refused = await fetchProfile(token, 'loop-test').catch((e: unknown) => e);
        expect(refused).toBeInstanceOf(AuthError);
        expect((refused as AuthError).status).toBe(429);
        await expect(fetchProfile(token, 'loop-test')).rejects.toBeInstanceOf(AuthError);
        expect(fetchMock).toHaveBeenCalledTimes(PROFILE_LIMIT);
        expect(reports).toEqual([['profile_request_storm', { caller: 'loop-test' }]]);
    });
});

describe('the two-factor check is asked once per launch', () => {
    beforeEach(() => forgetMfaCleared());

    test('an account that passed is remembered, another is not, and sign-out forgets', () => {
        expect(mfaClearedFor('u1')).toBe(false);
        markMfaCleared('u1');
        expect(mfaClearedFor('u1')).toBe(true);
        expect(mfaClearedFor('u2')).toBe(false);
        forgetMfaCleared();
        expect(mfaClearedFor('u1')).toBe(false);
    });

    test('an unknown account is never counted as cleared', () => {
        markMfaCleared(null);
        expect(mfaClearedFor(null)).toBe(false);
    });
});

describe('the welcome redirect is sent once per launch', () => {
    beforeEach(() => resetWelcomeRedirect());

    test('the first claim wins and the rest are refused', () => {
        expect([claimWelcomeRedirect(), claimWelcomeRedirect(), claimWelcomeRedirect()]).toEqual([true, false, false]);
    });
});

describe('where the pieces sit', () => {
    test('the first-run gate is inside the two-factor gate, so it cannot run while that gate is still checking', () => {
        const layout = read('app', '(app)', '_layout.tsx');
        const open = layout.indexOf('<MfaGate>');
        const gate = layout.indexOf('<FirstRunGate />');
        const close = layout.indexOf('</MfaGate>');
        expect(open).toBeGreaterThan(-1);
        expect(gate).toBeGreaterThan(open);
        expect(close).toBeGreaterThan(gate);
    });

    test('every screen that reads the profile says who it is', () => {
        for (const file of [['app', '(app)', 'account.tsx'], ['app', '(app)', 'privacy-export.tsx'], ['components', 'MenuDrawer.tsx'], ['components', 'account', 'MfaGate.tsx'], ['components', 'account', 'MfaCard.tsx']]) {
            expect(read(...file)).toMatch(/fetchProfile\(getAccessToken, '[a-z-]+'\)/);
        }
    });

    test('sign-out forgets the two-factor memory', () => {
        expect(read('auth', 'AuthProvider.tsx')).toMatch(/forgetMfaCleared\(\)/);
    });
});
