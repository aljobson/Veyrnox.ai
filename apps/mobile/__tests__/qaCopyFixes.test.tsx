import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { BestCutSettings } from '../src/components/editor/BestCutSettings';
import { setLocaleFromDevice, t } from '../src/lib/i18n';

jest.mock('../src/lib/bestCutSettings', () => ({ readBestCutSettings: async () => ({ captions: true, language: 'auto' }), writeBestCutSettings: async () => {} }));
void [RN.View, RN.Text, RN.Switch, RN.ScrollView];
let root: Root;
const textOf = (node: any): string => node.children.map((c: any) => typeof c === 'string' ? c : textOf(c)).join('');
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; setLocaleFromDevice(['en']); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

test.each(['image', 'video', 'audio'])('no-account notice never puts an article before %s', type => {
    const line = t('approvals.noAccounts', { type });
    expect(line).toBe(`No connected account can post ${type} files yet.`);
    expect(line).not.toMatch(/\ba (image|video|audio)\b/);
});
test('the captions switch label is sentence case', () => {
    expect(t('bestCut.captions')).toBe('Generate captions automatically');
});
test('Best Cut settings can hide their own title when a section already carries it', async () => {
    await act(async () => root.render(<BestCutSettings showTitle={false} />));
    expect(textOf(root.container)).not.toContain(t('bestCut.settings'));
    await act(async () => root.render(<BestCutSettings />));
    expect(textOf(root.container)).toContain(t('bestCut.settings'));
});
