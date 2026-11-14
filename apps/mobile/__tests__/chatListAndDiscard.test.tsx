import { act } from 'react';
import { createRoot } from 'test-renderer';
import { threadSubtitle } from '../src/lib/chat';
import { useChatThreadLoad } from '../src/lib/useChatThreadLoad';

const mockCalls = { get: jest.fn(), del: jest.fn(async () => ({ ok: true })) };
jest.mock('../src/lib/chat', () => ({ ...jest.requireActual('../src/lib/chat'), chatApi: () => ({
    getThread: mockCalls.get, deleteThread: mockCalls.del, listModelsWithLimits: async () => ({ models: [] }),
}) }));
jest.mock('../src/lib/chatLocal', () => ({ ...jest.requireActual('../src/lib/chatLocal'), forgetThread: jest.fn(async () => null) }));

const now = new Date('2026-11-14T15:00:00Z');
const models = [{ id: 'chat-gpt-6-luna', name: 'GPT-6 Luna' }];

test('subtitle shows the model name and time, never the raw id', () => {
    const s = threadSubtitle({ model_id: 'chat-gpt-6-luna', updated_at: '2026-11-14T14:05:00Z' }, models, 'en-GB', now);
    expect(s.startsWith('GPT-6 Luna · ')).toBe(true);
    expect(s).not.toContain('chat-gpt');
    expect(threadSubtitle({ model_id: 'chat-x-1', updated_at: '2026-10-01T10:00:00Z' }, models, 'en-GB', now)).toMatch(/^chat x 1 · /);
    expect(threadSubtitle({ model_id: 'chat-gpt-6-luna', updated_at: 'bad' }, models, 'en', now)).toBe('GPT-6 Luna');
});

function Probe() { useChatThreadLoad({} as never, 't1', 0, { started() {}, opened() {}, listed() {}, failed() {}, stop() {} }); return null; }
async function openAndLeave(first: unknown, second: unknown) {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mockCalls.get.mockReset().mockResolvedValueOnce(first).mockResolvedValue(second);
    mockCalls.del.mockClear();
    const root = createRoot();
    await act(async () => root.render(<Probe />));
    await act(async () => { await Promise.resolve(); });
    await act(async () => root.unmount());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
const empty = { thread: { id: 't1', system_prompt: null }, messages: [] };

test('an untouched new chat is removed when left', async () => {
    await openAndLeave(empty, empty);
    expect(mockCalls.del).toHaveBeenCalledWith('t1');
});
test('a chat that got a message is kept', async () => {
    await openAndLeave(empty, { ...empty, messages: [{ id: 'm' }] });
    expect(mockCalls.del).not.toHaveBeenCalled();
});
test('a chat opened with messages or instructions is kept', async () => {
    await openAndLeave({ ...empty, messages: [{ id: 'm' }] }, empty);
    expect(mockCalls.del).not.toHaveBeenCalled();
    await openAndLeave({ thread: { id: 't1', system_prompt: 'Be brief' }, messages: [] }, empty);
    expect(mockCalls.del).not.toHaveBeenCalled();
});

test('a chat opened again before the check finishes is kept', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mockCalls.get.mockReset().mockResolvedValue(empty);
    mockCalls.del.mockClear();
    const a = createRoot();
    await act(async () => a.render(<Probe />));
    await act(async () => { await Promise.resolve(); });
    const b = createRoot();
    await act(async () => { a.unmount(); b.render(<Probe />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(mockCalls.del).not.toHaveBeenCalled();
    await act(async () => b.unmount());
});
