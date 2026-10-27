import { act, useState } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { LegalDocumentView, type LegalLocation } from '../src/components/legal/LegalDocumentView';
import { LegalSheetContent } from '../src/components/legal/LegalSheet';
import { legalData, legalLink } from '../src/lib/legal';

const mockScroll = jest.fn();
const mockMeasure = jest.fn((_parent, success) => success(0, 720));
jest.mock('expo-secure-store', () => ({ getItem: () => null }));
jest.mock('react-native', () => {
    const React = jest.requireActual('react');
    return {
        Platform: { OS: 'ios' }, NativeModules: {}, Linking: { openURL: jest.fn() },
        View: ({ ref, ...props }: any) => {
            React.useImperativeHandle(ref, () => ({}), []);
            return React.createElement('View', props);
        },
        ScrollView: ({ ref, ...props }: any) => {
            React.useImperativeHandle(ref, () => ({ scrollTo: mockScroll }), []);
            return React.createElement('ScrollView', props);
        },
    };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../src/components/ui', () => {
    const React = jest.requireActual('react');
    return {
        Text: ({ ref, ...props }: any) => {
            React.useImperativeHandle(ref, () => ({ measureLayout: mockMeasure }), []);
            return React.createElement('Text', props);
        },
        Button: (props: any) => React.createElement('Button', props),
        themedStyles: (fn: any) => fn,
        useThemedStyles: (fn: any) => fn({}),
    };
});
let root: Root;
const textOf = (n: TestInstance): string => n.children.map(c => typeof c === 'string' ? c : textOf(c)).join('');
const layout = async () => {
    await act(async () => root.container.queryAll(n => n.type === 'ScrollView')[0].props.onContentSizeChange(320, 5000));
};
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot(); mockScroll.mockClear(); mockMeasure.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); });

test('the GDPR account-deletion link preserves its anchor in sheet history and scrolls to the web id', async () => {
    await act(async () => root.render(<LegalSheetContent doc="gdpr" onClose={jest.fn()} />));
    const link = root.container.queryAll(n => n.props.accessibilityRole === 'link' && n.props.onPress && textOf(n) === legalData('gdpr', 'en').messages.b009)[0];
    await act(async () => link.props.onPress());
    expect(root.container.queryAll(n => n.props.nativeID === 'account-deletion')).toHaveLength(1);
    await layout();
    expect(mockMeasure).toHaveBeenCalledTimes(1);
    expect(mockScroll).toHaveBeenLastCalledWith({ y: 720, animated: false });
    await act(async () => root.container.queryAll(n => n.props.label === 'Back')[0].props.onPress());
    await layout();
    expect(mockScroll).toHaveBeenLastCalledWith({ y: 0, animated: false });
});

test('same-document fragment changes reset measurements, and unknown ids fall back to the top', async () => {
    let navigate!: (location: LegalLocation) => void;
    function Host() {
        const [location, setLocation] = useState<LegalLocation>({ doc: 'privacy' });
        navigate = setLocation;
        return <LegalDocumentView {...location} onNavigate={setLocation} />;
    }
    await act(async () => root.render(<Host />));
    for (const [fragment, expected] of [['#youtube', 720], ['#missing', 0], ['#account-deletion', 720], ['#', 0]] as const) {
        const target = legalLink(fragment, 'privacy');
        if (target.kind !== 'legal') throw new Error('Expected native legal link');
        await act(async () => navigate(target));
        await layout();
        expect(mockScroll).toHaveBeenLastCalledWith({ y: expected, animated: false });
    }
});
