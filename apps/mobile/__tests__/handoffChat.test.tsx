import { act } from 'react';
import { createRoot } from 'test-renderer';
import { TextInput } from 'react-native';
import { useChatLocal } from '../src/lib/useChatLocal';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { createCache, createMemoryStorage } from '../src/lib/cache';

function Composer({ prompt }: { prompt?: string }) {
    const { draft, setDraft } = useChatLocal('11111111-1111-4111-8111-111111111111', prompt);
    return <TextInput value={draft} onChangeText={setDraft} />;
}
test('P5: the chat target opens with handed prompt as editable text, not a placeholder', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const storage = createMemoryStorage();
    resetCacheUser(); await bindCacheUser('chat-owner', createCache(storage), storage, createMemoryStorage());
    const root = createRoot();
    await act(async () => root.render(<Composer prompt="Fix this exact scene" />));
    expect(root.container.queryAll(n => n.props.value === 'Fix this exact scene').length).toBeGreaterThan(0);
    await act(async () => resetCacheUser());
    expect(root.container.queryAll(n => n.props.value === 'Fix this exact scene')).toHaveLength(0);
    await act(async () => root.unmount());
});
