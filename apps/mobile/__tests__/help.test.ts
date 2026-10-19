import type { ApiClient } from '../src/lib/api';
import { askHelp, helpErrorKey, helpRoute, MAX_QUESTION, parseHelpPlan, trimHistory } from '../src/lib/help';

describe('help plan', () => {
    test('reads the server plan and ignores anything else', () => {
        expect(parseHelpPlan({ plan: { message: ' Hi ', target: 'nav.credits', action: 'show_target' } })).toEqual({ message: 'Hi', target: 'nav.credits', action: 'show_target' });
        expect(parseHelpPlan({ plan: { message: '' } })).toBeNull();
        expect(parseHelpPlan({})).toBeNull();
        expect(parseHelpPlan(null)).toBeNull();
        expect(parseHelpPlan({ plan: { message: 'x', target: 5, action: 9 } })).toEqual({ message: 'x', target: null, action: 'none' });
    });
    test('history is the last six turns, trimmed to the route limits', () => {
        const turns = Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? ('assistant' as const) : ('user' as const), content: ' '.concat('x'.repeat(900)) }));
        const out = trimHistory(turns);
        expect(out).toHaveLength(6);
        expect(out.every((t) => t.content.length <= (t.role === 'user' ? 500 : 700))).toBe(true);
    });
});

describe('where help leads on the phone', () => {
    test('actions and targets map to phone screens', () => {
        expect(helpRoute({ target: null, action: 'open_credits' })).toBe('/credits');
        expect(helpRoute({ target: null, action: 'open_create' })).toBe('/create');
        expect(helpRoute({ target: 'chat.message', action: 'focus_target' })).toBe('/chat');
        expect(helpRoute({ target: 'create.cost', action: 'show_target' })).toBe('/create');
        expect(helpRoute({ target: 'nav.account', action: 'show_target' })).toBe('/account');
    });
    test('places the phone does not have give no button', () => {
        expect(helpRoute({ target: 'oddlings.builder', action: 'show_target' })).toBeNull();
        expect(helpRoute({ target: 'admin.overview', action: 'show_target' })).toBeNull();
        expect(helpRoute({ target: 'nav.credits', action: 'none' })).toBeNull();
        expect(helpRoute({ target: null, action: 'show_target' })).toBeNull();
    });
});

describe('askHelp', () => {
    test('posts the question and history, nothing that spends', async () => {
        const request = jest.fn().mockResolvedValue({ plan: { message: 'Use Credits.', target: 'nav.credits', action: 'show_target' } });
        const plan = await askHelp({ request } as unknown as ApiClient, `  ${'q'.repeat(600)}  `, [{ role: 'user', content: 'hi' }]);
        expect(plan.message).toBe('Use Credits.');
        const [path, init] = request.mock.calls[0];
        expect(path).toBe('/api/v1/help');
        expect(init.method).toBe('POST');
        const body = JSON.parse(init.body);
        expect(body.question).toHaveLength(MAX_QUESTION);
        expect(body.history).toEqual([{ role: 'user', content: 'hi' }]);
        expect(Object.keys(body).sort()).toEqual(['history', 'pathname', 'question']);
    });
    test('an answer with no message is an error', async () => {
        const request = jest.fn().mockResolvedValue({ plan: {} });
        await expect(askHelp({ request } as unknown as ApiClient, 'q', [])).rejects.toThrow('bad_help_answer');
    });
    test('errors read as plain words', () => {
        expect(helpErrorKey({ code: 'rate_limited' })).toBe('help.err.rate');
        expect(helpErrorKey({ code: 'network' })).toBe('help.err.network');
        expect(helpErrorKey(new Error('x'))).toBe('help.err.later');
    });
});
