import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync('packages/db/schema/supabase/0564_music_beat_doc_version_5.sql', 'utf8');
const allowlist = readFileSync('scripts/test-default-privileges.mjs', 'utf8');
test('prepared SQL replaces every legacy mutation with a guarded adapter and grants only explicit signatures', () => {
  const functions = [...sql.matchAll(/CREATE OR REPLACE FUNCTION (public|private)\.(save_music_beat_project|remove_music_beat_project)\(([^)]+)\)([\s\S]*?)\$\$;/g)];
  assert.equal(functions.length, 8);
  for (const [, schema, name, args, body] of functions) {
    assert.doesNotMatch(args, /DEFAULT/i); assert.match(body, /SET search_path = ''/);
    const signature = `${schema}.${name}(${args.split(',').map(arg => arg.trim().split(' ').at(-1)).join(',')})`;
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated, service_role;`));
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`));
    assert.ok(allowlist.includes(`'${signature}'`));
    if (!args.includes('p_client_beat_version')) {
      assert.match(body, /SELECT private\.(save|remove)_music_beat_project\([^;]+,4\)/);
      assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE)\b/i);
    } else if (schema === 'private') {
      assert.match(body, /SECURITY DEFINER/); assert.match(body, /saved.doc_version > p_client_beat_version/);
      assert.match(body, /RAISE EXCEPTION 'BEAT_CLIENT_OUTDATED' USING ERRCODE='PT409'/);
      assert.ok(body.indexOf('BEAT_CLIENT_OUTDATED') < body.search(/\b(INSERT INTO|UPDATE public|DELETE FROM)\b/));
      assert.ok(body.indexOf('FOR UPDATE') < body.indexOf('BEAT_CLIENT_OUTDATED'));
    }
  }
  assert.match(sql, /DROP CONSTRAINT IF EXISTS music_beat_projects_doc_version_check/);
  assert.match(sql, /CHECK \(doc_version BETWEEN 1 AND 5\)/);
});
