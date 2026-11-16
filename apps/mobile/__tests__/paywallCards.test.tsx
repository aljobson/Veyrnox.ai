import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { PackCard } from '../src/components/credits/PackCard';
import { PlanCards } from '../src/components/credits/PlanCards';
import { toDisplayPackages } from '../src/lib/billing';
import { t } from '../src/lib/i18n';
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
    await act(async () => root.render(<PackCard compact pack={pack} selectionMode="radio" selected disabled onPress={press} />));
    expect(controls('radio')[0].props.accessibilityState).toMatchObject({ selected: true, disabled: true });
    await click(controls('radio')[0]); expect(press).toHaveBeenCalledTimes(1);
});
test.each([true, false])('disabled plans block cadence and selection with readOnly=%s', async readOnly => {
    const choose = jest.fn(), cadence = jest.fn();
    await act(async () => root.render(<PlanCards plans={plans} packs={[pack]} credits={new Map()} chosenId={plans[0].id} disabled readOnly={readOnly} onChoose={choose} onCadence={cadence} />));
    for (const tab of controls('tab')) { expect(tab.props.accessibilityState.disabled).toBe(true); await click(tab); }
    for (const radio of controls('radio')) { expect(radio.props.accessibilityState).toMatchObject({ selected: true, disabled: true }); await click(radio); }
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
    expect(textOf(badged[0])).toContain('Starter');
    expect(t('creditsPage.recommended')).toBe('Recommended');
});
