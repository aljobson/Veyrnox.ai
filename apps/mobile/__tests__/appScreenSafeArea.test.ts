import { needsStackHorizontalSafeArea } from '../src/lib/appScreenSafeArea';

describe('signed-in stack landscape safe areas', () => {
    test.each([
        'publish/accounts',
        'templates/[id]',
        'oddlings/build',
        'features/[slug]',
        'job/[id]',
        'film/shot/[id]',
        'account',
        'vibe',
        'beats/index',
        'cinema/analytics',
        'editor/new',
        'music/a-future-route',
        'a-future-route',
    ])('%s is protected by the stack default', route => {
        expect(needsStackHorizontalSafeArea(route)).toBe(true);
    });

    test.each([
        'first-run',
        '(tabs)',
        'paywall',
        'rate',
        'smart-cut',
        'beats/[id]',
        'cinema/watch/[id]',
        'editor/[projectId]',
        'music/create',
    ])('%s keeps its route-owned safe-area contract', route => {
        expect(needsStackHorizontalSafeArea(route)).toBe(false);
    });
});
