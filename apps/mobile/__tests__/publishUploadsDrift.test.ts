declare const __dirname: string;
const { readFileSync } = require('fs');
const { resolve } = require('path');
import strings from '../src/lib/i18n/messages/en/publishUploads';
import { SOCIAL_UPLOAD_CAPS, SOCIAL_UPLOAD_TYPES } from '../src/lib/publishUploads';
const read = (path: string): string => readFileSync(resolve(__dirname, '../../..', path), 'utf8');
test('rights, reused errors and status wording exactly match the binding web catalog', () => {
    const web = read('lib/i18n/messages/app/en/publish.mjs');
    for (const suffix of ['rights', 'limits', 'failed', 'selectedNotice', 'canceled', 'removed', ...['upload_type_not_allowed', 'upload_size_required', 'upload_too_large', 'upload_budget_exceeded', 'upload_in_use', 'upload_type_mismatch', 'upload_unreadable'].map(c => `error.${c}`)]) {
        const line = web.split('\n').find(l => l.includes(`"app.publish.uploads.${suffix}"`))!;
        const value = JSON.parse(line.slice(line.indexOf(':') + 1).trim().replace(/,$/, ''));
        expect(strings[`publishUploads.${suffix}` as keyof typeof strings]).toBe(value);
    }
});
test('type and size allowlists, rights gate, account flag and SQL quota remain aligned', () => {
    const types = read('lib/social/uploadPolicy.js').match(/SOCIAL_UPLOAD_TYPES = \[([^\]]+)\]/)![1].match(/'([^']+)'/g)!.map(s => s.slice(1, -1));
    expect(SOCIAL_UPLOAD_TYPES).toEqual(types);
    const source = read('lib/uploadSource.js');
    for (const type of SOCIAL_UPLOAD_TYPES) {
        const mb = Number(source.match(new RegExp(`'${type}': \\{ maxBytes: (\\d+) \\* 1024 \\* 1024`))![1]);
        expect(SOCIAL_UPLOAD_CAPS[type]).toBe(mb * 1048576);
    }
    const route = read('app/api/v1/social/uploads/route.js');
    expect(route).toContain('body.rights_confirmed !== true'); expect(route).toContain("'uploads_not_open'");
    expect(read('app/api/v1/social/accounts/route.js')).toContain('uploadsEnabled: socialUploadsEnabled(');
    expect(read('packages/db/schema/supabase/0223_social_device_uploads.sql')).toContain('v_count >= 10 OR v_bytes + p_size > 209715200');
    expect(read('apps/mobile/src/lib/aiConsent.ts')).not.toContain('/api/v1/social/uploads');
});
