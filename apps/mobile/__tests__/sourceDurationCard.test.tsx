import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { SourceDurationCard } from '../src/components/create/SourceDurationCard';
import type { CatalogModel } from '../src/lib/media';
import { t } from '../src/lib/i18n';
declare const require: (id: string) => any;
declare const __dirname: string;
const { readFileSync } = require('fs');
const { resolve } = require('path');
void [RN.View, RN.Text];
const base: CatalogModel = { id: 'audio', name: 'Audio', modality: 'audio', credits: 7, gated: false, durations: [], capabilities: { media: { audio: { required: true, maxSeconds: 30 } } } };
let root: Root;
const hasText = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
test('required source duration shows the heading, follows text and displayed-price limit', async () => {
    await act(async () => root.render(<SourceDurationCard model={base} />));
    expect(hasText(t('sourceDuration.title'))).toBe(true);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'header' && n.children.includes(t('sourceDuration.title')))).toHaveLength(1);
    expect(hasText(t('sourceDuration.follows'))).toBe(true);
    expect(hasText('Up to 30 seconds at the displayed price.')).toBe(true);
    expect(hasText(t('sourceDuration.speech'))).toBe(false);
});
test.each([
    { ...base, modality: 'image' },
    { ...base, capabilities: { ...base.capabilities, presentation: { fixedDurationLabel: '10s' } } },
    { ...base, capabilities: { ...base.capabilities, presentation: { durationByOption: { '5': '10' } } } },
    { ...base, capabilities: { media: { audio: { required: false, maxSeconds: 30 } } } },
])('omits the card for ineligible model %p', async model => {
    await act(async () => root.render(<SourceDurationCard model={model} />));
    expect(root.container.children).toHaveLength(0);
});
test('only latentsync adds the speech note', async () => {
    await act(async () => root.render(<SourceDurationCard model={{ ...base, id: 'latentsync', modality: 'video-to-video' }} />));
    expect(hasText(t('sourceDuration.speech'))).toBe(true);
});
test('Create renders the source duration card immediately before shortfall', () => {
    const source = readFileSync(resolve(__dirname, '../src/app/(app)/create/[modelId].tsx'), 'utf8');
    expect(source).toMatch(/<SourceDurationCard model=\{model\} \/>\s*\{missing > 0/);
});
