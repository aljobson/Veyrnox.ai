import { isPublicationRead, isPublishReceipt, isUnpublishReceipt, isPublishInput, publicationName } from '../src/lib/music/validatePublication';
import { isSharedSong, listenToken } from '../src/lib/music/validateShared';
import { publication, input, receipt, shared, token } from './fixtures/musicPublication';

const invalidPublication = { slug: 'A'.repeat(24), status: 'draft', allow_comments: 1, allow_remixes: 'false',
    commercial_status: 'commercial', handle: 'Abc', display_name: '\u0000', published_at: 'yesterday' };
test('complete publication read, POST receipt, input, DELETE receipt and shared response fixtures', () => {
    expect(isPublicationRead({ publication })).toBe(true); expect(isPublicationRead({ publication: null })).toBe(true);
    for (const status of ['published', 'unpublished', 'blocked']) expect(isPublicationRead({ publication: { ...publication, status } })).toBe(true);
    expect(isPublicationRead({ publication: { ...publication, commercial_status: 'plan_eligible_terms_apply' } })).toBe(true);
    expect(isPublishReceipt(receipt)).toBe(true); expect(isPublishInput(input)).toBe(true);
    for (const idempotent of [true, false]) expect(isUnpublishReceipt({ ok: true, idempotent })).toBe(true);
    expect(isSharedSong(shared, token)).toBe(true);
});
test.each(Object.entries(invalidPublication))('read rejects invalid and missing %s', (field, value) => {
    expect(isPublicationRead({ publication: { ...publication, [field]: value } })).toBe(false);
    const missing: Record<string, unknown> = { ...publication }; delete missing[field];
    expect(isPublicationRead({ publication: missing })).toBe(false);
});
test.each(Object.entries({ ...invalidPublication, url: '/music/tracks/wrong', profile_url: '/music/creators/wrong' }).filter(([key]) => key !== 'published_at'))('receipt rejects invalid and missing %s', (field, value) => {
    expect(isPublishReceipt({ publication: { ...receipt.publication, [field]: value } })).toBe(false);
    const missing: Record<string, unknown> = { ...receipt.publication }; delete missing[field];
    expect(isPublishReceipt({ publication: missing })).toBe(false);
});
test.each(Object.entries({ version_id: 'v1', handle: 'ab', display_name: ' ', allow_comments: 'true', allow_remixes: null, rights_confirmed: false }))('publish input rejects invalid and missing %s', (field, value) => {
    expect(isPublishInput({ ...input, [field]: value })).toBe(false);
    const missing: Record<string, unknown> = { ...input }; delete missing[field]; expect(isPublishInput(missing)).toBe(false);
});
test.each([['ok', false], ['idempotent', 1]])('DELETE receipt rejects invalid and missing %s', (field, value) => {
    const body: Record<string, unknown> = { ok: true, idempotent: false };
    expect(isUnpublishReceipt({ ...body, [field as string]: value })).toBe(false);
    delete body[field as string]; expect(isUnpublishReceipt(body)).toBe(false);
});
test.each(Object.entries({ title: 'x'.repeat(121), version_number: 0, created_at: 'bad', audio_url: 'https://signed.test/private?signature=secret' }))('shared response rejects invalid and missing %s', (field, value) => {
    expect(isSharedSong({ song: { ...shared.song, [field]: value } }, token)).toBe(false);
    const missing: Record<string, unknown> = { ...shared.song }; delete missing[field]; expect(isSharedSong({ song: missing }, token)).toBe(false);
});
test('envelopes and projections reject missing, unknown and extra fields', () => {
    for (const body of [null, [], {}, { publication: [] }, { publication, extra: true }, { publication: { ...publication, extra: true } }]) expect(isPublicationRead(body)).toBe(false);
    expect(isPublishReceipt({ ...receipt, extra: true })).toBe(false);
    expect(isPublishReceipt({ publication: { ...receipt.publication, published_at: publication.published_at } })).toBe(false);
    expect(isPublishInput({ ...input, idempotency_key: 'injected' })).toBe(false);
    expect(isUnpublishReceipt({ ok: true, idempotent: false, extra: true })).toBe(false);
    for (const body of [null, [], {}, { song: null }, { ...shared, extra: true }, { song: { ...shared.song, extra: true } }]) expect(isSharedSong(body, token)).toBe(false);
    expect(isSharedSong(shared, 'z'.repeat(43))).toBe(false);
});
test.each(['', ' ', 'x'.repeat(81), 'A\nB', 'A\u007fB'])('invalid display name %j', value => expect(publicationName(value)).toBe(false));
test.each(['A', 'x'.repeat(80)])('valid name boundary %j', value => expect(publicationName(value)).toBe(true));
test.each(['', 'a'.repeat(42), 'a'.repeat(44), '/'.repeat(43), '../' + 'a'.repeat(40)])('invalid bearer token %j', value => {
    expect(listenToken(value)).toBe(false); expect(isSharedSong(shared, value)).toBe(false);
});
