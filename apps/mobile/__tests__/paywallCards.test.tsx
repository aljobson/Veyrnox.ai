import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { PackCard } from '../src/components/credits/PackCard';
import { PlanCards } from '../src/components/credits/PlanCards';
import { PurchaseState } from '../src/components/credits/PurchaseState';
import { PurchaseOutcomeState } from '../src/components/credits/PurchaseOutcomeState';
import { toDisplayPackages } from '../src/lib/billing';
import { t } from '../src/lib/i18n';
import { DEFAULT_APPEARANCE, tokensForScheme } from '../src/theme';
const packages = (products: string[]) => toDisplayPackages(products.map((product, i) => ({ identifier: String(i), product: { identifier: product, price: 10, priceString: '£10.00' } })) as any);
const pack = packages(['ai.veyrnox.credits.100'])[0];
const plans = packages(['ai.veyrnox.generation.starter.monthly', 'ai.veyrnox.generation.starter.annual']);
jest.mock('../src/components/VeyCardPeek', () => ({ peekRoom: () => 0 }));
void [RN.Pressable, RN.View, RN.Text];
let root: Root;
const controls = (role: string) => root.container.queryAll(n => n.props.accessibilityRole === role);
const click = async (node: TestInstance) => { await act(async () => node.props.onClick?.({ nativeEvent: {}, currentTarget: 1, target: 1 })); };
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
test('pack defaults remain buttons; radio mode exposes selected and disabled, and disabled presses do nothing', async () => {
    const press = jest.fn();
    await act(async () => root.render(<PackCard pack={pack} onPress={press} />));
    expect(controls('button')).toHaveLength(1); await click(controls('button')[0]); expect(press).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<PackCard compact pack={pack} best selectionMode="radio" selected disabled onPress={press} />));
    expect(controls('radio')[0].props.accessibilityState).toMatchObject({ checked: true, disabled: true });
    expect(root.container.queryAll(n => n.props.testID === 'pack-selected-indicator')).toHaveLength(1);
    expect(textOf(controls('radio')[0])).toContain(t('creditsPage.best'));
    await click(controls('radio')[0]); expect(press).toHaveBeenCalledTimes(1);
});
test('pack purchase progress is exposed as busy and selected without relying on colour', async () => {
    await act(async () => root.render(<PackCard pack={pack} chosen busy disabled onPress={jest.fn()} />));
    const card = controls('button')[0];
    expect(card.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(RN.StyleSheet.flatten(card.props.style)).toMatchObject({ borderWidth: 2, borderColor: tokensForScheme('light', DEFAULT_APPEARANCE).accent,
        backgroundColor: tokensForScheme('light', DEFAULT_APPEARANCE).bgElevated2 });
});
test.each([true, false])('disabled plans block cadence and selection with readOnly=%s', async readOnly => {
    const choose = jest.fn(), cadence = jest.fn();
    await act(async () => root.render(<PlanCards plans={plans} packs={[pack]} credits={new Map()} chosenId={plans[0].id} disabled readOnly={readOnly} onChoose={choose} onCadence={cadence} />));
    for (const tab of controls('tab')) { expect(tab.props.accessibilityState.disabled).toBe(true); await click(tab); }
    expect(controls('radiogroup')).toHaveLength(readOnly ? 0 : 1);
    for (const radio of controls('radio')) { expect(radio.props.accessibilityState).toMatchObject({ checked: true, disabled: true }); await click(radio); }
    expect(choose).not.toHaveBeenCalled(); expect(cadence).not.toHaveBeenCalled();
});
const textOf = (node: TestInstance): string => node.children.map(c => typeof c === 'string' ? c : textOf(c)).join('');
const allTiers = packages(['lite', 'starter', 'plus', 'ultra'].flatMap(f => ['monthly', 'annual'].map(c => `ai.veyrnox.generation.${f}.${c}`)));
test.each(['month', 'year'] as const)('only Starter carries the Recommended badge in the %s view', async cadence => {
    await act(async () => root.render(<PlanCards plans={allTiers} packs={[pack]} credits={new Map()} cadence={cadence} onChoose={jest.fn()} />));
    const cards = controls('radio');
    expect(cards).toHaveLength(3);
    expect(cards.some(card => textOf(card).includes('Ultra'))).toBe(false);
    const badged = cards.filter(card => textOf(card).includes(t('creditsPage.recommended')));
    expect(badged).toHaveLength(1);
    expect(RN.StyleSheet.flatten(badged[0].props.style).borderColor).not.toBe(tokensForScheme('light', DEFAULT_APPEARANCE).accent);
    expect(root.container.queryAll(n => n.props.testID === 'plan-selected-indicator')).toHaveLength(0);
    expect(textOf(badged[0])).toContain('Starter');
    expect(t('creditsPage.recommended')).toBe('Recommended');
});
test('plan cards lead with the included value, expose recommendation, and visibly select the chosen plan', async () => {
    const credits = new Map([['starter-monthly', 200]]);
    await act(async () => root.render(<PlanCards plans={plans} packs={[pack]} credits={credits} cadence="month" chosenId={plans[0].id} onChoose={jest.fn()} />));
    const card = controls('radio')[0], copy = textOf(card);
    expect(card.props.accessibilityState.checked).toBe(true);
    expect(root.container.queryAll(n => n.props.testID === 'plan-selected-indicator')).toHaveLength(1);
    expect(copy).toContain(t('creditsPage.recommended'));
    expect(card.props.accessibilityLabel).toContain('Starter plan, Recommended, 200 creation credits each month, £10.00 / month');
    expect(copy.indexOf('200 creation credits each month')).toBeLessThan(copy.indexOf('£10.00 / month'));
    expect(RN.StyleSheet.flatten(card.props.style)).toMatchObject({ borderWidth: 2, borderColor: tokensForScheme('light', DEFAULT_APPEARANCE).accent,
        backgroundColor: tokensForScheme('light', DEFAULT_APPEARANCE).bgElevated2 });
});
test('unselected plan and pack value copy reserve accent and warning colours for semantic states', async () => {
    const tokens = tokensForScheme('light', DEFAULT_APPEARANCE);
    const semanticInk = (node: TestInstance) => {
        const style = RN.StyleSheet.flatten(node.props.style);
        return style?.color === tokens.accent || style?.color === tokens.warning || style?.tintColor === tokens.accent || style?.tintColor === tokens.warning;
    };
    await act(async () => root.render(<PlanCards plans={plans} packs={[pack]} credits={new Map()} cadence="month" onChoose={jest.fn()} />));
    expect(controls('radio')[0].queryAll(semanticInk)).toHaveLength(0);
    await act(async () => root.render(<PackCard pack={pack} best saving={10} onPress={jest.fn()} />));
    expect(controls('button')[0].queryAll(semanticInk)).toHaveLength(0);
});
test('purchase states label waiting and unavailable feedback for assistive technology', async () => {
    await act(async () => root.render(<PurchaseState kind="loading" text="Loading purchases…" />));
    expect(root.container.queryAll(n => n.props.testID === 'purchase-state-loading' && n.props.accessibilityState?.busy === true)).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.testID === 'purchase-state-spinner')).toHaveLength(1);
    await act(async () => root.render(<PurchaseState kind="unavailable" text="Purchases unavailable" />));
    expect(root.container.queryAll(n => n.props.testID === 'purchase-state-unavailable' && n.props.accessibilityState?.busy === false)).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'alert' && textOf(n) === 'Purchases unavailable')).toHaveLength(1);
});
test.each([
    ['credited', false], ['subscribed', false], ['restored', false], ['nothingToRestore', false],
    ['cancelled', false], ['pending', false], ['error', true], ['sales_closed', true],
] as const)('%s purchase outcome has a persistent non-colour cue and correct urgency', async (kind, urgent) => {
    const outcome = kind === 'credited' ? { kind, balance: 100, credits: 100, price: '£1' } : { kind };
    await act(async () => root.render(<PurchaseOutcomeState outcome={outcome as any} />));
    const state = root.container.queryAll(n => n.props.testID === `purchase-outcome-${kind}`);
    expect(state).toHaveLength(1);
    expect(state[0].props.accessibilityRole === 'alert').toBe(urgent);
    expect(RN.StyleSheet.flatten(state[0].props.style)).toMatchObject({ borderWidth: 1 });
    expect(state[0].queryAll(n => n.props.importantForAccessibility === 'no')).toHaveLength(1);
});
