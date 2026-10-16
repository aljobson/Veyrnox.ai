import type pg from 'pg';

// These suites have two baselines: CI's historical schema-only bootstrap,
// and a disposable database rebuilt by replay-migrations.mjs. Replaying an
// older feature migration over the latter silently replaces newer functions
// (or fails when an OUT row type changed). Preserve the authoritative replay
// instead; this skips setup DDL only, never any behavior/security assertion.
export async function isFullSocialReplay(pool: pg.Pool): Promise<boolean> {
  const target = new URL(process.env.DATABASE_URL || '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.search) {
    throw new Error('Social acceptance requires a disposable localhost database');
  }
  const result = await pool.query(`SELECT to_regprocedure(
    'public.list_social_publish_activity_page(text,uuid,integer,timestamp with time zone,uuid,text)'
  ) IS NOT NULL AS ready`);
  return result.rows[0].ready === true;
}
