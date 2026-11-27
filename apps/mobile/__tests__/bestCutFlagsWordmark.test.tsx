import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { BestCutSettings } from '../src/components/editor/BestCutSettings';
import { BEST_CUT_LANGUAGES } from '../src/lib/bestCutPlan';
import { LANGUAGES } from '../src/lib/language';
import { brandText } from '../src/components/BrandText';
import { setLocaleFromDevice, t } from '../src/lib/i18n';
jest.mock('../src/lib/bestCutSettings', () => ({ readBestCutSettings: async () => ({ captions: true, language: 'auto' }), writeBestCutSettings: async () => {} }));
jest.mock('../src/components/ui', () => {
    const React = require('react');
    const component = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
    return { Text: component('text'), Chip: component('chip') };
});
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; setLocaleFromDevice(['en']); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
test('transcription-language chips explain paid provider behavior and select Spanish', async () => {
    const onChange = jest.fn();
    await act(async () => root.render(<BestCutSettings onChange={onChange} />));
    const rendered = root.container.queryAll(n => typeof n.props.children === 'string').map(n => n.props.children).join(' ');
    expect(rendered).toContain(t('bestCut.language'));
    expect(rendered).toContain(t('bestCut.languageHelp'));
    expect(t('bestCut.languageHelp')).toMatch(/transcription service/i);
    expect(t('bestCut.languageHelp')).toMatch(/may cost credits/i);
    const chips = root.container.queryAll(n => n.type === 'chip');
    expect(chips).toHaveLength(BEST_CUT_LANGUAGES.length + 1);
    const auto = chips.find(c => c.props.label === t('bestCut.auto'))!;
    expect(auto.props.selected).toBe(true);
    expect(auto.queryAll(n => n.type === 'text' && String(n.props.testID ?? '').startsWith('best-cut-flag'))).toHaveLength(0);
    for (const code of BEST_CUT_LANGUAGES) {
        const chip = chips.find(c => c.props.label === t(`bestCut.language.${code}`))!;
        const flag = chip.queryAll(n => n.props.testID === `best-cut-flag-${code}`)[0];
        expect(flag.props.children).toBe(LANGUAGES.find(l => l.code === code)!.flag);
        expect(flag.props.accessibilityElementsHidden).toBe(true);
        expect(chip.props.accessibilityLabel).toBeUndefined();
        expect(chip.props.label).not.toContain(flag.props.children);
    }
    const spanish = chips.find(c => c.props.label === t('bestCut.language.es'))!;
    await act(async () => spanish.props.onPress());
    expect(onChange).toHaveBeenLastCalledWith({ captions: true, language: 'es' });
    expect(spanish.props.selected).toBe(true);
});
test('the consent text prints the brand as the bold wordmark VEYRNOX.ai', () => {
    const parts = brandText(t('bestCut.consent')) as any[];
    const brand = parts.filter(p => p.props?.style?.fontFamily);
    expect(brand).toHaveLength(1);
    expect(brand[0].props.children.join('')).toBe('VEYRNOX.ai');
    expect(brand[0].props.style.fontWeight).toBe('900');
    expect(parts.filter(p => !p.props?.style?.fontFamily).map(p => p.props.children).join('')).not.toContain('Veyrnox.ai');
});
