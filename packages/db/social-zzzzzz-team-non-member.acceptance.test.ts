import { isFullSocialReplay } from './test-support/social-acceptance-bootstrap.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// 0305 compared a NULL role with NOT IN, which is never true, so callers with no role
// on a brand passed the FORBIDDEN check (0403).
describe('social team changes refuse non-members (0403)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
    const value = async (sql: string, args: unknown[] = []) => (await one(sql, args)).value;
    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
        if (await isFullSocialReplay(pool)) return;
        for (const file of ['0305_social_team_roles.sql', '0403_social_team_non_member_guard.sql']) {
            const migration = await readFile(new URL(`./schema/supabase/${file}`, import.meta.url), 'utf8');
            await pool.query(migration); await pool.query(migration);
        }
    });
    after(async () => { if (pool) await pool.end(); });

    async function user(prefix: string) {
        const auth = randomUUID(); const email = `${prefix}-${randomUUID()}@test.veyrnox.ai`;
        await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, email]);
        const id = await value('SELECT public.provision_user($1,$2) value', [auth, email]); return { auth, id, email };
    }
    async function team() {
        const owner = await user('owner'); const editor = await user('editor'); const outsider = await user('outsider');
        const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
        await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
            VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `non-member-${randomUUID()}`]);
        const invite = await value('SELECT public.invite_social_team_member($1,$2,$3,$4) value', [owner.auth, brand, editor.email, 'editor']);
        assert.equal((await value('SELECT public.accept_social_team_invite($1,$2) value', [editor.auth, invite.invite_id])).ok, true);
        return { owner, editor, outsider, brand };
    }
    const role = async (brand: string, userId: string) =>
        (await one('SELECT role FROM public.social_brand_members WHERE brand_id=$1 AND user_id=$2', [brand, userId]))?.role;

    it('does not let a non-member change a role or remove a member', async () => {
        const { editor, outsider, brand } = await team();
        assert.deepEqual(await value('SELECT public.change_social_team_member($1,$2,$3,$4,$5) value', [outsider.auth, brand, editor.id, 'role', 'manager']),
            { ok: false, code: 'BRAND_NOT_FOUND' });
        assert.deepEqual(await value('SELECT public.change_social_team_member($1,$2,$3,$4,$5) value', [outsider.auth, brand, editor.id, 'remove', null]),
            { ok: false, code: 'BRAND_NOT_FOUND' });
        assert.equal(await role(brand, editor.id), 'editor');
        assert.equal(await value(`SELECT count(*)::int value FROM public.social_team_events WHERE brand_id=$1 AND actor_user_id=$2`, [brand, outsider.id]), 0);
    });

    it('does not let a non-member or an unknown identity revoke a pending invite', async () => {
        const { owner, outsider, brand } = await team(); const invited = await user('pending');
        const pending = await value('SELECT public.invite_social_team_member($1,$2,$3,$4) value', [owner.auth, brand, invited.email, 'viewer']);
        assert.deepEqual(await value('SELECT public.revoke_social_team_invite($1,$2,$3) value', [outsider.auth, brand, pending.invite_id]),
            { ok: false, code: 'BRAND_NOT_FOUND' });
        assert.deepEqual(await value('SELECT public.revoke_social_team_invite($1,$2,$3) value', [randomUUID(), brand, pending.invite_id]),
            { ok: false, code: 'BRAND_NOT_FOUND' });
        assert.equal(await value('SELECT status value FROM public.social_brand_invitations WHERE id=$1', [pending.invite_id]), 'pending');
    });

    it('still lets the owner and a lower member get the right answers', async () => {
        const { owner, editor, brand } = await team();
        assert.deepEqual(await value('SELECT public.change_social_team_member($1,$2,$3,$4,$5) value', [editor.auth, brand, editor.id, 'role', 'manager']),
            { ok: false, code: 'FORBIDDEN' });
        assert.deepEqual(await value('SELECT public.change_social_team_member($1,$2,$3,$4,$5) value', [owner.auth, brand, editor.id, 'role', 'reviewer']),
            { ok: true });
        assert.equal(await role(brand, editor.id), 'reviewer');
    });
});
