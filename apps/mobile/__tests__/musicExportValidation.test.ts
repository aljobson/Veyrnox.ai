import { isExportQuote, isExportStart, isExportFile, EXPORT_MIME, EXPORT_FORMATS } from '../src/lib/music/validateExport';
import { quote, start, file } from './fixtures/musicExport';
test.each(EXPORT_FORMATS)('complete %s fixtures', format => {
    expect(isExportQuote({ quote: { ...quote, format } }, format)).toBe(true);
    expect(isExportQuote({ quote: { ...quote, consumes_allowance: false, remaining_after: 5, format } }, format)).toBe(true);
    expect(isExportStart(start)).toBe(true); expect(isExportStart({ ...start, idempotent: true })).toBe(true);
    expect(isExportFile({ export: { ...file, format, mime_type: EXPORT_MIME[format] } }, format, file.id)).toBe(true);
});
test.each(Object.keys(quote))('quote requires %s', key => {
    const value = { ...quote } as Record<string, unknown>; delete value[key];
    expect(isExportQuote({ quote: value }, 'mp3')).toBe(false);
});
test.each([
    ['id', 'bad'], ['format', 'wav'], ['consumes_allowance', 1], ['allowance', -1], ['allowance', 1.2],
    ['allowance', Infinity], ['allowance', Number.MAX_SAFE_INTEGER + 1], ['used', -1], ['used', 8], ['used', 0.5],
    ['remaining_after', -1], ['remaining_after', 4.5], ['remaining_after', 3], ['expires_at', 'bad'], ['expires_at', 12],
])('rejects quote %s=%s', (key, value) => expect(isExportQuote({ quote: { ...quote, [key]: value } }, 'mp3')).toBe(false));
test.each(['export', 'allowance', 'idempotent'])('start requires %s', key => {
    const value = { ...start } as Record<string, unknown>; delete value[key]; expect(isExportStart(value)).toBe(false);
});
test.each(['id', 'state'])('start export requires %s', key => {
    const value = { ...start.export } as Record<string, unknown>; delete value[key]; expect(isExportStart({ ...start, export: value })).toBe(false);
});
test.each(['total', 'used', 'remaining'])('start allowance rejects missing/invalid %s', key => {
    for (const bad of [undefined, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '4']) {
        expect(isExportStart({ ...start, allowance: { ...start.allowance, [key]: bad } })).toBe(false);
    }
});
test('start rejects malformed identity, state, replay, over-use and inconsistent remaining', () => {
    for (const value of [{ ...start, export: { id: 'bad', state: 'ready' } }, { ...start, export: { ...start.export, state: 'queued' } },
        { ...start, idempotent: 'true' }, { ...start, allowance: { total: 2, used: 3, remaining: 0 } },
        { ...start, allowance: { total: 7, used: 3, remaining: 3 } }]) expect(isExportStart(value)).toBe(false);
});
test.each(Object.keys(file))('read requires %s', key => {
    const value = { ...file } as Record<string, unknown>; delete value[key]; expect(isExportFile({ export: value }, 'mp3', file.id)).toBe(false);
});
test.each([
    ['id', quote.id], ['id', 'bad'], ['state', 'queued'], ['format', 'wav'], ['mime_type', 'audio/wav'], ['mime_type', 'audio/mp3'],
    ['size_bytes', 0], ['size_bytes', -1], ['size_bytes', 1.5], ['size_bytes', Number.MAX_SAFE_INTEGER + 1], ['size_bytes', Infinity],
    ['expires_in', Infinity], ['expires_in', NaN], ['expires_in', '300'], ['expires_in', 0], ['expires_in', -1],
    ['url', 'http://signed.test/a'], ['url', 'https://user:pass@signed.test/a'], ['url', 'https://user@signed.test/a'],
    ['url', 'https://'], ['url', '/song'], ['url', 'file:///private/song'], ['url', 'not a url'],
])('rejects read %s=%s', (key, value) => expect(isExportFile({ export: { ...file, [key]: value } }, 'mp3', file.id)).toBe(false));
test.each([null, [], {}, { quote: null }, { export: null }])('rejects malformed envelopes %s', value => {
    expect(isExportQuote(value, 'mp3')).toBe(false); expect(isExportStart(value)).toBe(false); expect(isExportFile(value, 'mp3', file.id)).toBe(false);
});
