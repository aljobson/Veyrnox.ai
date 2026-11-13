import { act } from 'react';
import { createRoot } from 'test-renderer';
import Route from '../src/app/(app)/live-edit';
import { PHOTO_STUDIO_ENABLED } from '../src/lib/photoStudioFlag';
import * as flag from '../src/lib/photoStudioFlag';
import { getCacheUser } from '../src/lib/appCache';
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: jest.fn(() => 'owner'), subscribeCacheUser: () => () => {} }));
jest.mock('../src/components/liveEdit/LiveEditScreen', () => ({ LiveEditScreen: () => { const { View } = jest.requireActual('react-native'); return <View testID="enabled-local-editor" />; } }));
test('shipping constant is off and direct route navigation cannot mount native editor', async () => {
    expect(PHOTO_STUDIO_ENABLED).toBe(false);
    const root = createRoot();
    await act(async () => root.render(<Route />));
    expect(root.container.queryAll(n => n.props.testID === 'enabled-local-editor')).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
    await act(async () => root.unmount());
});
test('only a code-enabled flag and current owner open editor', async () => {
    const mutable = flag as { PHOTO_STUDIO_ENABLED: boolean }; mutable.PHOTO_STUDIO_ENABLED = true;
    const root = createRoot();
    try {
        await act(async () => root.render(<Route />));
        expect(root.container.queryAll(n => n.props.testID === 'enabled-local-editor').length).toBeGreaterThan(0);
        jest.mocked(getCacheUser).mockReturnValue(undefined);
        await act(async () => root.render(<Route />));
        expect(root.container.queryAll(n => n.props.testID === 'enabled-local-editor')).toHaveLength(0);
    } finally { mutable.PHOTO_STUDIO_ENABLED = false; jest.mocked(getCacheUser).mockReturnValue('owner'); await act(async () => root.unmount()); }
});
