import { fetchPopularIds, templateChips, templatesFor, templatePrice, previewRatio, templatePageHref } from '../src/lib/templateFilters';
import { chooseLocale } from '../src/lib/i18n';
import { parsePresets, presetHref } from '../src/lib/presets';
import { readTemplate } from '../src/lib/templateHandoff';
import { mediaApi } from '../src/lib/media';
import type { ApiClient } from '../src/lib/api';
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: async () => {}, hasAgreed: async () => true } }));
const presets = parsePresets({ presets: ['a', 'b', 'c'].map((id, index) => ({ id, title: id, category: index === 1 ? 'PET' : 'STYLE', modelId: 'm', prompt: 'words', credits: 3, isNew: index === 0, durationSeconds: 5 })) });
afterEach(() => chooseLocale('en'));
test('chips follow category order, hide missing popular and new, and popular preserves ranking', () => {
    expect(templateChips(presets, ['c', 'a'])).toEqual(['ALL', 'NEW', 'POPULAR', 'STYLE', 'PET']);
    expect(templateChips(presets.map(p => ({ ...p, isNew: false })), ['missing'])).toEqual(['ALL', 'STYLE', 'PET']);
    expect(templatesFor(presets, 'POPULAR', ['c', 'a']).map(p => p.id)).toEqual(['c', 'a']);
    expect(templatesFor(presets, 'NEW', []).map(p => p.id)).toEqual(['a']);
});
test('translated feed prices, bounded ratios, detail route and validated attribution', () => {
    chooseLocale('de'); expect(templatePrice(presets[0])).not.toContain('credits');
    expect(previewRatio({ ...presets[0], previewAspect: '100:1' })).toBe(16 / 9);
    expect(previewRatio(presets[0])).toBe(9 / 16);
    expect(templatePageHref(presets[0])).toEqual({ pathname: '/templates/[id]', params: { id: 'a' } });
    expect(presetHref(presets[0]).params).toMatchObject({ tid: 'a' });
    expect(readTemplate({ tpl: 'Title', tid: 'Bad ID' }, [])?.id).toBeNull();
});
test('popular failure is empty and invalid ids are discarded with a cap of twenty', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    expect(await fetchPopularIds()).toEqual([]);
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ templates: ['Bad ID', ...Array.from({ length: 22 }, (_, i) => `id-${i}`)] }) } as Response);
    expect(await fetchPopularIds()).toHaveLength(20); fetch.mockRestore();
});
test.each(['valid-id', 'Bad ID', '', 'a'.repeat(41)])('generation sends only valid preset %s', async preset => {
    const request = jest.fn().mockResolvedValue({ job_id: 'job' });
    await mediaApi({ request } as unknown as ApiClient).createGeneration({ modelId: 'model', prompt: 'words', durationSeconds: null, confirmedCredits: 3, idempotencyKey: 'key', preset });
    expect(JSON.parse(request.mock.calls[0][1].body).preset).toBe(preset === 'valid-id' ? preset : undefined);
});
