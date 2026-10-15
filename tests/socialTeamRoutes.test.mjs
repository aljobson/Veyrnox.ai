import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));

const ownerRoute = await import('../app/api/v1/social/team/route.js');
const acceptRoute = await import('../app/api/v1/social/team/accept/route.js');
const publicRoute = await import('../app/api/social/team/[token]/route.js');
const { createTeamInviteToken } = await import('../lib/social/teamInviteToken.js');

const auth = '11111111-1111-4111-8111-111111111111';
const brand = '22222222-2222-4222-8222-222222222222';
const invite = '33333333-3333-4333-8333-333333333333';
const member = '44444444-4444-4444-8444-444444444444';
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', PUBLISH_TEAMS_ENABLED: 'true',
    SOCIAL_TEAM_INVITE_SECRET: 'team-route-secret-with-more-than-thirty-two-characters', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true',
});
const request = (url, method = 'GET', body) => new Request(url, { method, headers: { 'x-veyrnox-auth-id': auth, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
let calls = [];
function stub(overrides = {}) {
    calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop(); const args = JSON.parse(init.body); calls.push({ name, args });
        return Response.json(overrides[name] ?? ({
            consume_account_read_request: { ok: true }, consume_social_post_write_request: { ok: true },
            get_or_create_default_social_brand: { ok: true, brand_id: brand },
            list_social_team: { ok: true, brand_id: brand, brand_name: 'Veyrnox', actor_role: 'owner', members: [{ user_id: member, email: 'owner@example.com', role: 'owner' }], invitations: [{ id: invite, email: 'person@example.com', role: 'editor', expires_at: '2026-11-01T10:00:00Z' }] },
            invite_social_team_member: { ok: true, idempotent: false, invite_id: invite, email: 'person@example.com', role: 'editor', expires_at: '2026-11-01T10:00:00Z' },
            get_social_team_invite: { ok: true, invite_id: invite, email: 'person@example.com', role: 'editor', status: 'pending', expires_at: '2026-11-01T10:00:00Z', brand_id: brand, brand_name: 'Veyrnox' },
            accept_social_team_invite: { ok: true, idempotent: false, brand_id: brand, role: 'editor' },
        })[name]);
    };
}

test('owner lists a team and receives signed links for pending invitations', async () => {
    stub(); const response = await ownerRoute.GET(request(`https://veyrnox.ai/api/v1/social/team?brand_id=${brand}`));
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.actor_role, 'owner'); assert.equal(body.members[0].role, 'owner');
    assert.match(body.invitations[0].url, /^https:\/\/veyrnox\.ai\/social\/team\/invite\//);
});

test('owner creates a normalized invitation and receives its signed link', async () => {
    stub(); const response = await ownerRoute.POST(request('https://veyrnox.ai/api/v1/social/team', 'POST', { brandId: brand, email: ' Person@Example.com ', role: 'editor' }));
    assert.equal(response.status, 201); const body = await response.json();
    assert.equal(body.invitation.email, 'person@example.com'); assert.match(body.invitation.url, /\/social\/team\/invite\//);
    assert.equal(calls.at(-1).name, 'invite_social_team_member'); assert.equal(calls.at(-1).args.p_email, 'person@example.com');
});

test('signed public link exposes only its safe invitation projection and accepts through the authenticated route', async () => {
    stub(); const token = await createTeamInviteToken({ inviteId: invite }, process.env.SOCIAL_TEAM_INVITE_SECRET); const params = Promise.resolve({ token });
    const preview = await publicRoute.GET(request(`https://veyrnox.ai/api/social/team/${token}`), { params });
    assert.equal(preview.status, 200); assert.deepEqual(Object.keys(await preview.json()).sort(), ['brand_id', 'brand_name', 'email', 'expires_at', 'invite_id', 'role', 'status']);
    const accepted = await acceptRoute.POST(request('https://veyrnox.ai/api/v1/social/team/accept', 'POST', { token }));
    assert.equal(accepted.status, 200); assert.equal((await accepted.json()).role, 'editor'); assert.equal(calls.at(-1).name, 'accept_social_team_invite');
});

test('forged public links are rejected without a database call', async () => {
    stub(); const response = await publicRoute.GET(request('https://veyrnox.ai/api/social/team/forged'), { params: Promise.resolve({ token: 'forged' }) });
    assert.equal(response.status, 404); assert.equal(calls.length, 0);
});
