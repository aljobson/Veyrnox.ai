// Offline component contract tests; device verification is reported separately.
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { TemplatePhotoSlots } from '../src/components/TemplatePhotoSlots';
import type { CatalogModel } from '../src/lib/media';
import type { ApiClient } from '../src/lib/api';
import { checkPicked } from '../src/lib/sources';
import { settingsInputs, optionsFor } from '../src/lib/createOptions';
import { t } from '../src/lib/i18n';
const mockSlots: any[] = [];
jest.mock('../src/components/SourcePicker', () => ({ SourcePicker: (props: any) => { mockSlots.push(props); return null; } }));
const model = { id: 'seedance-2.0-reference', name: 'Reference', modality: 'image-to-video', credits: 85, gated: false, durations: [5, 10], capabilities: { media: { image: { required: true, maxFiles: 9 } }, inputs: { prompt: { max: 30000 } } } } as CatalogModel;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mockSlots.length = 0; });
for (let count = 1; count <= 9; count++) test(`${count} required positions retain order after remove and replace`, async () => {
    const root = createRoot(); const onReferences = jest.fn(), onBusy = jest.fn();
    await act(async () => root.render(<TemplatePhotoSlots count={count} model={model} api={{} as ApiClient} references={[]} onReferences={onReferences} onBusy={onBusy} />));
    expect(mockSlots).toHaveLength(count);
    for (let i = 0; i < count; i++) {
        expect(mockSlots[i].slot).toMatchObject({ label: t('presets.fidelity.photoSlot', { number: i + 1 }), required: true, maxFiles: 1, minSide: 256 });
        await act(async () => mockSlots[i].onChange(`photo-${i}`));
        if (i < count - 1) expect(onReferences).toHaveBeenLastCalledWith([]);
    }
    const expected = Array.from({ length: count }, (_, i) => ({ slot: 'image', origin: 'upload', key: `photo-${i}` }));
    expect(onReferences).toHaveBeenLastCalledWith(expected);
    const previousReferences = onReferences.mock.calls.at(-1)![0];
    const position = Math.min(1, count - 1);
    await act(async () => mockSlots[position].onChange(undefined));
    expect(onReferences).toHaveBeenLastCalledWith([]);
    expect(previousReferences).toEqual(expected);
    await act(async () => mockSlots[position].onChange('replacement'));
    expected[position].key = 'replacement';
    expect(onReferences).toHaveBeenLastCalledWith(expected);
    expect(onReferences.mock.calls.at(-1)![0]).not.toBe(previousReferences);
    await act(async () => mockSlots[0].onBusy(true)); expect(onBusy).toHaveBeenLastCalledWith(true);
    await act(async () => mockSlots[0].onBusy(false)); expect(onBusy).toHaveBeenLastCalledWith(false);
    await act(async () => root.unmount());
});
test('slot checks type, 20 MB and known 256 pixel floor, deferring decode failure', () => {
    const file = { uri: 'file:///photo.png', size: 1024, mimeType: 'image/png', width: 256, height: 256 };
    expect(checkPicked('image', file, { minSide: 256 }).ok).toBe(true);
    for (const invalid of [{ ...file, size: 20 * 1024 * 1024 + 1 }, { ...file, mimeType: 'video/mp4' }, { ...file, width: 255 }]) expect(checkPicked('image', invalid, { minSide: 256 }).ok).toBe(false);
    expect(checkPicked('image', { ...file, width: 0, height: 0 }, { minSide: 256 }).ok).toBe(true);
});
test('custom mobile negative settings keep the base slice trailing whitespace', () => {
    const options = { ...optionsFor(model), negativeMax: 5 };
    expect(settingsInputs(options, { seed: '', negative: 'word more', aspect: null }).negative_prompt).toBe('word ');
});

for (const maxFiles of [1, 9]) test(`capability maximum ${maxFiles} gates uploads before mounting a picker`, async () => {
    const root = createRoot();
    const live = { ...model, capabilities: { ...model.capabilities, media: { image: { required: true, maxFiles } } } } as CatalogModel;
    await act(async () => root.render(<TemplatePhotoSlots count={3} model={live} api={{} as ApiClient} references={[]} onReferences={jest.fn()} onBusy={jest.fn()} />));
    expect(mockSlots).toHaveLength(maxFiles === 1 ? 0 : 3);
    await act(async () => root.unmount());
});
test('renumbered photo hints are rendered for every mobile slot', async () => {
    const { templatePhotoHints } = require('../src/lib/templateFidelity');
    const sourcePrompt = 'Vehicle @image2 near the gate. Person @image1 wears a hat.';
    const hints = templatePhotoHints({ class: 'bound', slotCount: 2, sourcePrompt, tokenMap: [
        { token: '@image2', target: '@Image1', slot: 1, offset: sourcePrompt.indexOf('@image2') },
        { token: '@image1', target: '@Image2', slot: 2, offset: sourcePrompt.indexOf('@image1') },
    ] });
    const root = createRoot();
    await act(async () => root.render(<TemplatePhotoSlots count={2} hints={hints} model={model} api={{} as ApiClient} references={[]} onReferences={jest.fn()} onBusy={jest.fn()} />));
    const output = root.container.queryAll(node => typeof node.props.children === 'string').map(node => node.props.children).join('\n');
    for (const hint of hints) expect(output).toContain(hint);
    expect(mockSlots).toHaveLength(2);
    await act(async () => root.unmount());
});

// Shared helper uses the same 40-character surroundings for canonical slot order.
test('already ordered photo roles retain bounded source hints on mobile', () => {
    const { templatePhotoHints } = require('../src/lib/templateFidelity');
    const { bind } = require('../../../lib/templateBinding');
    const source = 'The silver car is @image1. The red bicycle is @image2.';
    const hints = templatePhotoHints({ class: 'bound', slotCount: 2, sourcePrompt: source, tokenMap: bind(source, 2).map });
    expect(hints).toHaveLength(2);
    expect(hints[0]).toContain('silver car');
    expect(hints[1]).toContain('red bicycle');
    for (const hint of hints) expect(hint.length).toBeLessThanOrEqual(87);
});
