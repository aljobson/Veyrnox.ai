import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { admissionRequired, admissionAvailable, ADMISSION_FLAG, ADMISSION_PROVIDERS } from '../lib/uploadAdmission.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the gate is off unless the flag is exactly "true"', () => {
    for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes', ' true']) {
        assert.equal(admissionRequired({ [ADMISSION_FLAG]: value }), false, String(value));
        assert.deepEqual(admissionAvailable({ [ADMISSION_FLAG]: value }), { required: false, ok: true });
    }
});

test('required with no enrolled provider refuses, whatever provider the environment names', () => {
    assert.deepEqual(Object.keys(ADMISSION_PROVIDERS), [], 'no adapter is enrolled yet');
    const refused = { required: true, ok: false, error: 'upload_admission_unavailable' };
    assert.deepEqual(admissionAvailable({ [ADMISSION_FLAG]: 'true' }), refused);
    for (const name of ['photodna', 'iwf', '__proto__', 'constructor', 'toString']) {
        assert.deepEqual(admissionAvailable({ [ADMISSION_FLAG]: 'true', UPLOAD_HASH_MATCH_PROVIDER: name }), refused, name);
    }
});

test('every entry point that mints a browser PUT checks the gate first', () => {
    const sites = [
        ['app/api/v1/uploads/route.js', /admissionAvailable\(\)[\s\S]*presignPutUrl\(derived\.key/],
        ['app/api/v1/social/uploads/route.js', /admissionAvailable\(\)[\s\S]*presignPutUrl\(result\.r2_key/],
        ['app/api/v1/projects/[id]/assets/route.js', /admissionAvailable\(\)[\s\S]*tenantRequest\(request, context, 'rpc\/reserve_project_asset'/],
    ];
    for (const [file, order] of sites) assert.match(read(file), order, `${file}: gate must run before anything is reserved or signed`);
});

test('a stored upload is not handed to a provider while the gate is required and unmet', () => {
    const src = read('lib/resolveSource.js');
    assert.match(src, /export async function resolveUploadedSource[\s\S]*admissionAvailable\(\)[\s\S]*inspectStoredSource/);
    assert.match(src, /source_not_admitted/);
});

test('the gate leaves our own finished generations alone', () => {
    const src = read('lib/resolveSource.js');
    const asset = src.slice(src.indexOf('export async function resolveAssetSource'), src.indexOf('/** Sign the stored object'));
    assert.doesNotMatch(asset, /admissionAvailable/);
});

test('the flag is not set in production wrangler vars (absent is off; the Worker is at its binding cap)', () => {
    const production = read('wrangler.jsonc').split('"env"')[0];
    assert.doesNotMatch(production, /UPLOAD_HASH_MATCH_REQUIRED/);
});
