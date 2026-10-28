import { ApiError, type ApiClient } from '../src/lib/api';
import { importContacts, importErrorKey, manualContact, parseContactCsv } from '../src/lib/publishContactImport';
import { TAG_RE } from '../src/lib/publishContacts';
import { ID } from './publishDepthTestHelpers';
declare const __dirname: string;
const fs = require('fs'), path = require('path');
const valid = 'external_id,name,tags,subscription_status,notes\na,A,VIP|vip,subscribed,Note';
test('CSV quoted delimiters, escaped quotes, newlines, missing optional cells and case normalization', () => {
    expect(parseContactCsv(valid)).toEqual({ contacts: [{ externalId: 'a', name: 'A', tags: ['vip'], subscriptionStatus: 'subscribed', notes: 'Note' }] });
    expect(parseContactCsv('EXTERNAL_ID,NAME,notes\n"a,b","A ""name""","line\nnext"\n\n')).toEqual({ contacts: [{ externalId: 'a,b', name: 'A "name"', tags: [], subscriptionStatus: 'unknown', notes: 'line\nnext' }] });
    expect(parseContactCsv('external_id,name,tags\na,A').contacts?.[0].tags).toEqual([]);
});
test.each([
    ['', 'empty'], ['external_id,name', 'headers'], ['name\nA', 'headers'], ['external_id,name,nope\na,A,x', 'headers'], ['external_id,name,name\na,A,A', 'headers'],
    ['external_id,name\na,A,extra', 'columns'], ['external_id,name\n,A', 'row'], ['external_id,name\na,', 'row'], ['external_id,name\n"a,A', 'quote'],
    ['external_id,name\na,A\na,B', 'duplicate'], ['external_id,name,tags\na,A,café', 'row'], ['external_id,name,subscription_status\na,A,nope', 'row'],
    [`external_id,name\n${'x'.repeat(257)},A`, 'row'], [`external_id,name\na,${'x'.repeat(121)}`, 'row'],
    [`external_id,name,tags\na,A,${'x'.repeat(33)}`, 'row'], [`external_id,name,notes\na,A,${'x'.repeat(2001)}`, 'row'],
    [`external_id,name,tags\na,A,${Array.from({ length: 11 }, (_, i) => `t${i}`).join('|')}`, 'row'],
    ['external_id,name\n' + Array.from({ length: 251 }, (_, i) => `${i},A`).join('\n'), 'tooMany'],
])('CSV failure maps to %s / %s', (text, key) => expect(parseContactCsv(text).error).toBe(`publishOps.csv.${key}`));
test('web parser contract drift: headers, limit and tag regex', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../lib/social/contactCsv.js'), 'utf8');
    expect(source).toContain("const REQUIRED = ['external_id', 'name'];");
    expect(source).toContain("const ALLOWED = new Set(['external_id', 'name', 'tags', 'subscription_status', 'notes']);");
    expect(source).toContain('contacts.length > 250'); expect(source).toContain(`const TAG = ${TAG_RE.toString()};`);
});
test('manual validation and exact import body', async () => {
    const parsed = manualContact({ externalId: ' a ', name: ' A ', tags: 'VIP, vip', subscriptionStatus: 'unknown', notes: ' note ' });
    expect(parsed.contact).toEqual({ externalId: 'a', name: 'A', tags: ['vip'], subscriptionStatus: 'unknown', notes: 'note' });
    expect(manualContact({ externalId: '', name: 'A', tags: '', subscriptionStatus: 'unknown', notes: '' }).error).toBe('contacts.err.invalid');
    const request = jest.fn().mockResolvedValue({ imported: 1 }); expect(await importContacts({ request } as unknown as ApiClient, ID, 'manual', [parsed.contact!])).toBe(1);
    expect(request).toHaveBeenCalledWith('/api/v1/social/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: ID, source: 'manual', contacts: [parsed.contact] }) });
    expect(importErrorKey(new ApiError(404, 'gone'))).toBe('publishOps.import.accountGone'); expect(importErrorKey(new ApiError(400, 'bad'))).toBe('contacts.err.invalid'); expect(importErrorKey(new ApiError(403, 'role'))).toBe('contacts.err.role');
});
