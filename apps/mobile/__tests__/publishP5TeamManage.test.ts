import { ApiError, type ApiClient } from '../src/lib/api';
import { canManage, changeRole, parseTeam, removeMember, revokeInvite, rolesFor, teamActionErrorKey } from '../src/lib/publishTeam';

const apiWith = () => {
    const request = jest.fn(async (_p: string, _i?: RequestInit) => ({ ok: true }));
    return { api: { request } as unknown as ApiClient, request };
};

describe('team manage', () => {
    test('the team read keeps the brand id', () => {
        expect(parseTeam({ brand_id: 'b-1', brand_name: 'Acme', actor_role: 'owner' }).brandId).toBe('b-1');
        expect(parseTeam({}).brandId).toBe('');
    });
    test('who can be changed by whom', () => {
        expect(canManage('owner', 'editor')).toBe(true);
        expect(canManage('owner', 'manager')).toBe(true);
        expect(canManage('owner', 'owner')).toBe(false);
        expect(canManage('manager', 'editor')).toBe(true);
        expect(canManage('manager', 'manager')).toBe(false);
        expect(canManage('manager', 'owner')).toBe(false);
        expect(canManage('editor', 'viewer')).toBe(false);
    });
    test('a manager cannot hand out the manager role', () => {
        expect(rolesFor('owner')).toContain('manager');
        expect(rolesFor('manager')).not.toContain('manager');
        expect(rolesFor('manager')).toContain('editor');
    });
    test('role change, removal and revoke send the right requests', async () => {
        const { api, request } = apiWith();
        await changeRole(api, 'b1', 'u1', 'editor');
        expect(request.mock.calls[0][1]?.method).toBe('PATCH');
        expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ brandId: 'b1', memberUserId: 'u1', action: 'role', role: 'editor' });
        await removeMember(api, 'b1', 'u1');
        expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ brandId: 'b1', memberUserId: 'u1', action: 'remove' });
        await revokeInvite(api, 'b 1', 'i/1');
        expect(request.mock.calls[2][0]).toBe('/api/v1/social/team?brand_id=b%201&invite_id=i%2F1');
        expect(request.mock.calls[2][1]?.method).toBe('DELETE');
    });
    test('error keys', () => {
        expect(teamActionErrorKey(new ApiError(404, 'MEMBER_NOT_FOUND'))).toBe('team.err.gone');
        expect(teamActionErrorKey(new ApiError(403, 'FORBIDDEN'))).toBe('team.err.cannot');
        expect(teamActionErrorKey(new ApiError(400, 'INVALID_ROLE'))).toBe('team.err.invalid');
        expect(teamActionErrorKey(new ApiError(0, 'network'))).toBe('team.err.network');
    });
});
