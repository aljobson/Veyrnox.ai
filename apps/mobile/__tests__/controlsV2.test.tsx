import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { Button } from '../src/components/ui/Button';
import { TextField } from '../src/components/ui/TextField';
import { DEFAULT_APPEARANCE, tokensForScheme } from '../src/theme';
import { AppearanceContext } from '../src/components/ui/AppearanceContext';

let mockPressableProps: RN.PressableProps;
jest.mock('react-native', () => {
    const actual = jest.requireActual('react-native');
    return Object.defineProperties({}, {
        ...Object.getOwnPropertyDescriptors(actual),
        Pressable: {
            enumerable: true,
            value: (props: RN.PressableProps) => {
                mockPressableProps = props;
                return require('react').createElement(actual.View, { testID: 'button' }, props.children);
            },
        },
    });
});
jest.mock('../src/components/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
void [RN.View, RN.Text, RN.TextInput];
let root: Root;
beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });

test('buttons default to button semantics but preserve a link override', async () => {
    await act(async () => root.render(<Button label="Action" />));
    expect(mockPressableProps.accessibilityRole).toBe('button');
    await act(async () => root.render(<Button label="Browse first" accessibilityRole="link" />));
    expect(mockPressableProps.accessibilityRole).toBe('link');
});
test.each(['light', 'dark', 'oled'] as const)('disabled secondary retains its surface fill at 0.4 opacity in %s', async (theme) => {
    const settings = { ...DEFAULT_APPEARANCE, theme };
    const onPress = jest.fn();
    await act(async () => root.render(
        <AppearanceContext value={settings}><Button variant="secondary" label="Make a video" disabled onPress={onPress} /></AppearanceContext>,
    ));
    const style = mockPressableProps.style;
    if (typeof style !== 'function') throw Error('Expected the button press styles');
    for (const pressed of [false, true]) {
        const layers = style({ pressed, hovered: false } as Parameters<typeof style>[0]);
        const resolved = Array.isArray(layers) ? Object.assign({}, ...layers.filter(Boolean)) : layers;
        expect(resolved).toMatchObject({
            backgroundColor: tokensForScheme(theme === 'light' ? 'light' : 'dark', settings).surface,
            opacity: 0.4,
        });
    }
    mockPressableProps.onPress?.({} as RN.GestureResponderEvent);
    expect(onPress).not.toHaveBeenCalled();
});
test('a label-free text field retains its accessible name without duplicating visible copy', async () => {
    await act(async () => root.render(<TextField accessibilityLabel="Start with your own idea" />));
    expect(root.container.queryAll((node) => node.children.includes('Start with your own idea'))).toHaveLength(0);
    expect(root.container.queryAll((node) => node.props.accessibilityLabel === 'Start with your own idea')).toHaveLength(1);
});
