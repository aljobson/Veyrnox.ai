import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// social_brand_role() returns NULL for a caller with no role on the brand. In SQL,
// `NULL NOT IN (...)` and `NULL <> 'x'` are NULL, so an IF built on them is skipped
// and the caller passes. 0305 shipped that bug (fixed by 0403). This checks the
// newest definition of every function that reads the role into a variable.
const dir = new URL('../packages/db/schema/supabase/', import.meta.url);
const FUNCTION_RE = /CREATE OR REPLACE FUNCTION\s+public\.(\w+)\s*\(([^)]*)\)[\s\S]*?\$(\w*)\$([\s\S]*?)\$\3\$/gi;

function latestDefinitions() {
    const latest = new Map();
    for (const name of readdirSync(dir).filter(file => /^\d{4}_.*\.sql$/.test(file)).sort()) {
        for (const match of readFileSync(new URL(name, dir), 'utf8').matchAll(FUNCTION_RE)) {
            const arity = match[2].split(',').filter(arg => arg.trim()).length;
            latest.set(`${match[1]}/${arity}`, { file: name, body: match[4] });
        }
    }
    return latest;
}

export function unguardedRoleChecks(body) {
    const variables = [...body.matchAll(/(\w+)\s*:=\s*public\.social_brand_role\(/g)].map(match => match[1]);
    const problems = [];
    for (const variable of new Set(variables)) {
        let guarded = false;
        for (const line of body.split('\n')) {
            if (new RegExp(`\\b${variable}\\s+IS\\s+NULL\\b`, 'i').test(line)) { guarded = true; continue; }
            const nullUnsafe = new RegExp(`\\b${variable}\\b\\s*(NOT\\s+IN\\b|<>|!=)|\\bNOT\\s*\\(?\\s*${variable}\\b`, 'i');
            if (nullUnsafe.test(line) && !guarded) problems.push(`${variable}: ${line.trim()}`);
        }
    }
    return problems;
}

test('the checker flags the 0305 pattern and accepts a guarded version', () => {
    const vulnerable = "v_role:=public.social_brand_role(a,b);\nIF v_role NOT IN ('owner','manager') THEN RETURN x; END IF;";
    assert.equal(unguardedRoleChecks(vulnerable).length, 1);
    assert.deepEqual(unguardedRoleChecks(`v_role:=public.social_brand_role(a,b);\nIF v_role IS NULL THEN RETURN x; END IF;\n${vulnerable.split('\n')[1]}`), []);
    assert.deepEqual(unguardedRoleChecks("v_role:=public.social_brand_role(a,b);\nIF v_role IS NULL OR v_role NOT IN ('owner') THEN RETURN x; END IF;"), []);
});

test('every current function guards a missing brand role before denying by role', () => {
    const found = [];
    for (const [signature, { file, body }] of latestDefinitions()) {
        for (const problem of unguardedRoleChecks(body)) found.push(`${signature} (${file}) ${problem}`);
    }
    assert.deepEqual(found, []);
});

test('0403 is the newest definition of both team-administration functions', () => {
    const latest = latestDefinitions();
    assert.equal(latest.get('change_social_team_member/5').file, '0403_social_team_non_member_guard.sql');
    assert.equal(latest.get('revoke_social_team_invite/3').file, '0403_social_team_non_member_guard.sql');
});
