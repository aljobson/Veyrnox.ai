import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('social team roles (0305)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
    const value = async (sql: string, args: unknown[] = []) => (await one(sql, args)).value;
    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
        const migration = await readFile(new URL('./schema/supabase/0305_social_team_roles.sql', import.meta.url), 'utf8');
        await pool.query(migration); await pool.query(migration);
    });
    after(async () => { if (pool) await pool.end(); });

    async function user(email: string) {
        const auth = randomUUID(); await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, email]);
        const id = await value('SELECT public.provision_user($1,$2) value', [auth, email]); return { auth, id, email };
    }
    async function paidOwner() {
        const owner = await user(`owner-${randomUUID()}@test.veyrnox.ai`);
        const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
        await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
            VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`, [owner.id, `team-plan-${randomUUID()}`]);
        return { owner, brand };
    }

    it('binds invitations to the invited email and lists the accepted member', async () => {
        const { owner, brand } = await paidOwner(); const invited = await user(`member-${randomUUID()}@test.veyrnox.ai`); const wrong = await user(`wrong-${randomUUID()}@test.veyrnox.ai`);
        const made = await value('SELECT public.invite_social_team_member($1,$2,$3,$4) value', [owner.auth, brand, invited.email, 'editor']);
        assert.equal(made.ok, true, JSON.stringify(made));
        assert.equal((await value('SELECT public.get_social_team_invite($1) value', [made.invite_id])).brand_id, brand);
        assert.deepEqual(await value('SELECT public.accept_social_team_invite($1,$2) value', [wrong.auth, made.invite_id]), { ok: false, code: 'EMAIL_MISMATCH' });
        const accepted = await value('SELECT public.accept_social_team_invite($1,$2) value', [invited.auth, made.invite_id]);
        assert.deepEqual([accepted.ok, accepted.role, accepted.idempotent], [true, 'editor', false]);
        const listed = await value('SELECT public.list_social_team($1,$2) value', [owner.auth, brand]);
        assert.equal(listed.members.find((entry: { email: string }) => entry.email === invited.email).role, 'editor');
    });

    it('lets managers administer lower roles while reserving manager access for owners', async () => {
        const { owner, brand } = await paidOwner(); const manager = await user(`manager-${randomUUID()}@test.veyrnox.ai`); const editor = await user(`editor-${randomUUID()}@test.veyrnox.ai`);
        const managerInvite = await value('SELECT public.invite_social_team_member($1,$2,$3,$4) value', [owner.auth, brand, manager.email, 'manager']);
        await value('SELECT public.accept_social_team_invite($1,$2) value', [manager.auth, managerInvite.invite_id]);
        assert.deepEqual(await value('SELECT public.invite_social_team_member($1,$2,$3,$4) value', [manager.auth, brand, editor.email, 'manager']), { ok: false, code: 'FORBIDDEN' });
        const editorInvite = await value('SELECT public.invite_social_team_member($1,$2,$3,$4) value', [manager.auth, brand, editor.email, 'editor']);
        assert.equal(editorInvite.ok, true);
        await value('SELECT public.accept_social_team_invite($1,$2) value', [editor.auth, editorInvite.invite_id]);
        assert.deepEqual(await value('SELECT public.change_social_team_member($1,$2,$3,$4,$5) value', [manager.auth, brand, editor.id, 'role', 'reviewer']), { ok: true });
        assert.deepEqual(await value('SELECT public.change_social_team_member($1,$2,$3,$4,$5) value', [manager.auth, brand, manager.id, 'remove', null]), { ok: false, code: 'FORBIDDEN' });
        assert.deepEqual(await value('SELECT public.change_social_team_member($1,$2,$3,$4,$5) value', [owner.auth, brand, manager.id, 'remove', null]), { ok: true });
    });

    it('keeps team tables closed to browser roles and its event ledger append-only', async () => {
        const { owner, brand } = await paidOwner(); const invited = await user(`audit-${randomUUID()}@test.veyrnox.ai`);
        await value('SELECT public.invite_social_team_member($1,$2,$3,$4) value', [owner.auth, brand, invited.email, 'viewer']);
        for (const table of ['social_brand_members', 'social_brand_invitations', 'social_team_events']) for (const role of ['anon', 'authenticated']) {
            assert.equal((await one(`SELECT has_table_privilege($1,$2,'SELECT') OR has_table_privilege($1,$2,'INSERT') allowed`, [role, `public.${table}`])).allowed, false, `${role} on ${table}`);
        }
        await assert.rejects(() => pool.query(`UPDATE public.social_team_events SET detail='{}'::jsonb WHERE brand_id=$1`, [brand]), /append-only/);
    });
});
