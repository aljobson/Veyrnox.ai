import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { OddlingCatalog } from '../src/components/oddlings/OddlingCatalog';
import { groupById, type Picks } from '../src/lib/oddlingsBuilder';
import { t } from '../src/lib/i18n';
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.Image];
let root: Root;
const pick = jest.fn();
const event = { nativeEvent: {}, target: 1, currentTarget: 1 };
const radio = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'radio' && n.props.accessibilityLabel === label)[0];
const press = async (label: string) => { await act(async () => radio(label).props.onClick(event)); };
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); pick.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); });
async function render(categoryId: string, picks: Picks = {}) { await act(async () => root.render(<OddlingCatalog categoryId={categoryId} picks={picks} onCategory={() => {}} onPick={pick} />)); }
test('hair swatches, picture tiles and Any/None dispatch values and expose selection', async () => {
    await render('hair', { hair: 'Bald', hair_color: 'Black' });
    const hair = groupById('hair')!, color = groupById('hair_color')!;
    expect(radio(`${hair.label}: Bald`).props.accessibilityState.selected).toBe(true);
    await press(`${hair.label}: ${hair.options[1][2]}`); expect(pick).toHaveBeenLastCalledWith('hair', hair.options[1][0]);
    await press(`${hair.label}: ${t('oddlingsStudio.none')}`); expect(pick).toHaveBeenLastCalledWith('hair', '');
    await press(`${color.label}: ${color.options[1][2]}`); expect(pick).toHaveBeenLastCalledWith('hair_color', color.options[1][0]);
    await press(`${color.label}: Any`); expect(pick).toHaveBeenLastCalledWith('hair_color', '');
    expect(root.container.queryAll(n => n.props.cachePolicy === 'disk').length).toBeGreaterThan(0);
});
test('body steps and adjustable actions dispatch clamped scale values', async () => {
    await render('body', { height: 'Short' });
    const label = groupById('height')!.label;
    expect(radio(`${label}: Short`).props.accessibilityState.selected).toBe(true);
    await press(`${label}: Tall`); expect(pick).toHaveBeenLastCalledWith('height', 'Tall');
    const slider = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable' && n.props.accessibilityLabel === label)[0];
    expect(slider.props.accessibilityValue.text).toBe('Short');
    await act(async () => slider.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(pick).toHaveBeenLastCalledWith('height', 'Average');
    await press(`${label}: Any`); expect(pick).toHaveBeenLastCalledWith('height', '');
});
