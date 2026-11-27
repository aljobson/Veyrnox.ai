import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { CrunTemplateCard } from '../src/components/templates/CrunTemplateCard';
import type { CrunTemplatePreview } from '../src/lib/crunTemplateSummary';
import { catalogTemplateImageBounds } from '../src/lib/catalogTemplateInputs';
import { t } from '../src/lib/i18n';

jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-video', () => ({ VideoView: jest.requireActual('react-native').View, useVideoPlayer: () => ({ addListener: () => ({ remove: jest.fn() }) }) }));
void [RN.View, RN.Text, RN.Pressable];

const template = (credits: number | null): CrunTemplatePreview => ({
    catalogId: 'kling:1:1:test', id: 'test', providerTemplateId: 'test', name: 'Test template', category: 'Effects', tag: null,
    coverUrl: null, previewUrl: null, previewKind: null, inputCount: 1, inputRequirement: null, providerCredits: null,
    credits, minInputCount: 1, maxInputCount: 1, requirements: [], prices: [],
});

let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

test('template action is disabled without a valid price and enabled with one', async () => {
    await act(async () => root.render(<CrunTemplateCard template={template(null)} playing={false} onPlay={() => {}} onUse={() => {}} />));
    let use = root.container.queryAll(node => node.props.accessibilityLabel === t('crunTemplates.use'))[0];
    expect(use.props.accessibilityState.disabled).toBe(true);
    await act(async () => root.render(<CrunTemplateCard template={template(12)} playing={false} onPlay={() => {}} onUse={() => {}} />));
    use = root.container.queryAll(node => node.props.accessibilityLabel === t('crunTemplates.use'))[0];
    expect(use.props.accessibilityState.disabled).toBe(false);
});

test('image limits stay family-specific even when route parameters are tampered', () => {
    expect(catalogTemplateImageBounds('kling', 0, 8)).toEqual({ min: 0, max: 5 });
    expect(catalogTemplateImageBounds('vidu', 2, 8)).toEqual({ min: 2, max: 5 });
    expect(catalogTemplateImageBounds('seedance', 0, 8)).toEqual({ min: 0, max: 8 });
});
