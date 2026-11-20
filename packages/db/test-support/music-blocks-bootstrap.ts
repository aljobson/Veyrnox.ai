import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// A private, disposable DB, fully replayed from scratch (replay-migrations.mjs applies the base schema too;
// running migrate.mjs first makes the replay fail on 0001). Never replay over another suite's database.
export async function musicBlocksDatabase(connectionString: string) {
    const target = new URL(connectionString);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.search) throw Error('Disposable localhost PostgreSQL required');
    const pg = (await import('pg')).default;
    const admin = new pg.Client({ connectionString });
    await admin.connect();
    const name = `music_blocks_${randomUUID().replaceAll('-', '')}_test`;
    let created = false;
    const cleanup = async () => {
        try { if (created) await admin.query(`DROP DATABASE "${name}"`); }
        finally { await admin.end(); }
    };
    try {
        await admin.query(`CREATE DATABASE "${name}"`); created = true;
        target.pathname = `/${name}`;
        const root = fileURLToPath(new URL('../../../', import.meta.url));
        for (const script of ['replay-migrations.mjs']) {
            await promisify(execFile)(process.execPath, [`scripts/${script}`], {
                cwd: root, env: { ...process.env, DATABASE_URL: target.href }, maxBuffer: 8 * 1024 * 1024,
            });
        }
        return { connectionString: target.href, cleanup };
    } catch (error) { await cleanup(); throw error; }
}
