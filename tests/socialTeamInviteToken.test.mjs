import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeamInviteToken, teamInviteSigningSecret, verifyTeamInviteToken } from '../lib/social/teamInviteToken.js';

const secret = 'team-invite-secret-with-more-than-thirty-two-characters';
const inviteId = '11111111-1111-4111-8111-111111111111';

test('team invitation tokens bind an expiring invitation id', async () => {
    const token = await createTeamInviteToken({ inviteId }, secret);
    assert.equal(await verifyTeamInviteToken(token, secret), inviteId);
    assert.equal(await verifyTeamInviteToken(`${token}x`, secret), null);
});

test('team invitation tokens reject expiry and weak secrets', async () => {
    const token = await createTeamInviteToken({ inviteId, expiresInSeconds: -1 }, secret);
    assert.equal(await verifyTeamInviteToken(token, secret), null);
    assert.equal(await verifyTeamInviteToken('broken', secret), null);
    await assert.rejects(() => createTeamInviteToken({ inviteId }, 'short'));
});

test('team invitation signing uses a dedicated secret or a purpose-separated OAuth root', () => {
    assert.equal(teamInviteSigningSecret({ SOCIAL_TEAM_INVITE_SECRET: secret, SOCIAL_OAUTH_STATE_SECRET: 'x'.repeat(48) }), secret);
    assert.equal(teamInviteSigningSecret({ SOCIAL_OAUTH_STATE_SECRET: 'x'.repeat(48) }), `${'x'.repeat(48)}:veyrnox:publish:team-invite:v1`);
    assert.equal(teamInviteSigningSecret({ SOCIAL_OAUTH_STATE_SECRET: 'weak' }), null);
});
