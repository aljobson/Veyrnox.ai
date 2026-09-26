import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const route = read('../app/api/v1/generations/route.js');
const page = read('../app/veyrnox/app/create/page.js');
const errors = read('../app/veyrnox/_lib/createErrors.js');
const aup = read('../app/legal/aup/page.js');
const legalNav = read('../app/legal/_lib/Legal.js');
const footer = read('../app/veyrnox/_sections/footer.js');
const sitemap = read('../app/sitemap.js');
const migration = read('../packages/db/schema/supabase/0096_upload_consent_attestation.sql');

test('a job with an upload is refused without the consent statement', () => {
    assert.match(route, /if \(!consent\) return NextResponse\.json\(\{ error: 'consent_required' \}, \{ status: 400 \}\);/);
    assert.match(route, /const consent = body && body\.consent === true;/);
    assert.match(errors, /consent_required:/);
});

test('the statement is recorded on the job through the RPC, not a direct write', () => {
    assert.match(route, /rpc\('job_consent_attested', \{ p_job_id: jobId \}, cfg\)/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS consent_attested_at TIMESTAMPTZ NULL/);
    assert.match(migration, /SET search_path = ''/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.job_consent_attested\(UUID\) TO service_role;/);
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
        assert.ok(migration.includes(`REVOKE ALL ON FUNCTION public.job_consent_attested(UUID) FROM ${role};`), role);
    }
});

test('the create page blocks Generate until the box is ticked, and sends it', () => {
    assert.match(page, /const missingConsent = hasUpload && !consent;/);
    assert.match(page, /missingSource \|\| missingConsent\)\}/);
    assert.match(page, /consent: source_keys\.length \? true : undefined,/);
    assert.match(page, /I own this file, or I have the permission of everyone identifiable in it/);
    assert.match(page, /href="\/legal\/aup"/);
});

test('the Acceptable Use Policy is published and linked', () => {
    assert.match(aup, /canonical: '\/legal\/aup'/);
    for (const rule of [/Sexual content/, /minors/, /Impersonation and deepfakes/, /voice-cloning/, /AI-generated/]) {
        assert.match(aup, rule);
    }
    assert.match(legalNav, /href="\/legal\/aup"/);
    assert.match(footer, /href="\/legal\/aup"/);
    assert.match(sitemap, /'\/legal\/aup'/);
});

// ADR-0058 decision 7: the same statement is kept once at account level, with
// the wording version it was made under, through a service-role-only RPC.
test('an upload request also records the account-level rights attestation, service role only', () => {
    const route = readFileSync(new URL('../app/api/v1/generations/route.js', import.meta.url), 'utf8');
    assert.match(route, /export const RIGHTS_ATTESTATION_VERSION = '[a-z0-9-]{3,40}'/);
    assert.match(route, /rpc\('attest_upload_rights', \{ p_user_id: userId, p_version: RIGHTS_ATTESTATION_VERSION \}, cfg\)/);
    const migration = readFileSync(new URL('../packages/db/schema/supabase/0146_content_violations_and_rights_attestation.sql', import.meta.url), 'utf8');
    assert.match(migration, /ADD COLUMN IF NOT EXISTS rights_attested_at TIMESTAMPTZ NULL/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.attest_upload_rights\(UUID, TEXT\) FROM PUBLIC, anon, authenticated;/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.attest_upload_rights\(UUID, TEXT\) TO service_role;/);
    for (const fn of ['record_content_violation(TEXT, UUID, UUID, TEXT, TEXT)', 'list_content_violations(TEXT, UUID, INTEGER)']) {
        assert.ok(migration.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`), fn);
        assert.ok(migration.includes(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`), fn);
    }
    // Both admin RPCs check users.is_admin themselves, like ops_metrics_24h.
    assert.equal((migration.match(/RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501'/g) || []).length, 2);
});
