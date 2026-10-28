import { composeGates, postActions, toggleAccount } from '../src/lib/publishComposeGates';
import { parseAccounts, type PublishRole, type PublishPost } from '../src/lib/publish';

const enabled = { plansEnabled: true, planTier: 'publish', queuesEnabled: true, contentPresetsEnabled: true, variantsEnabled: true, youtubeVisibilityEnabled: true };
test.each([
    [{}, [true, true, true, true, true, true, true]],
    [{ plansEnabled: false }, [true, true, true, true, true, false, true]],
    [{ planTier: 'free' }, [false, false, false, false, false, false, true]],
    [{ queuesEnabled: false }, [true, true, true, false, true, true, true]],
    [{ contentPresetsEnabled: false }, [true, true, true, true, false, true, true]],
    [{ variantsEnabled: false }, [true, true, true, true, true, false, true]],
    [{ youtubeVisibilityEnabled: false }, [true, true, true, true, true, true, false]],
])('gates with %o', (overrides, expected) => {
    expect(Object.values(composeGates(parseAccounts({ ...enabled, ...overrides })))).toEqual(expected);
});
test('missing YouTube flag is closed; single and multiple selection toggle independently', () => {
    expect(composeGates(parseAccounts({})).youtubeVisibility).toBe(false);
    expect(toggleAccount(['a'], 'b', false)).toEqual(['b']);
    expect(toggleAccount(['a'], 'a', false)).toEqual([]);
    expect(toggleAccount(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleAccount(['a', 'b'], 'a', true)).toEqual(['b']);
});
const roles: (PublishRole | null)[] = [null, 'viewer', 'reviewer', 'analyst', 'editor', 'manager', 'owner'];
for (const role of roles) for (const status of ['scheduled', 'canceled', 'published', 'failed']) for (const pending of [true, false]) for (const updatedAt of [null, 'stamp']) {
    test(`actions: ${role}/${status}/${pending}/${updatedAt}`, () => {
        const post = { status, updatedAt, targets: [{ publishStatus: 'pending' }, { publishStatus: pending ? 'pending' : 'publishing' }] } as PublishPost;
        const result = postActions(post, role);
        const permitted = role === 'owner' || role === 'manager' || role === 'editor';
        expect(result.reschedule).toBe(permitted && pending && status === 'scheduled');
        expect(result.cancel).toBe(permitted && pending && status === 'scheduled' && updatedAt !== null);
        expect(result.restore).toBe(permitted && pending && status === 'canceled' && updatedAt !== null);
        expect(result.note).toBe(role === null ? null : !permitted && ['scheduled', 'canceled'].includes(status) ? 'publishParity.post.readOnly' : permitted && !pending ? 'publishParity.post.locked' : null);
    });
}
